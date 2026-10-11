// Semantics ledger. When agents' programs disagree about a rule, decide it
// once against the reference documents (e.g. the DABstep manual) instead of
// encoding both readings as an option flag, and turn each decision into tests
// that every helper must pass. Pattern from dpyr's SEMANTICS.md (one numbered
// decision per disagreement, each backed by a test) and LATM's generated unit
// tests. See docs/skill-formation-research.md.

import { normalizeCode, type Executor, type ResolvedProvider } from "@cloudflare/codemode";
import { runAi } from "./ai";
import { CODE_MODEL } from "./generalize";
import { safeExecute, withHelpers, type Conflict, type Helper, type LedgerRow } from "./refactor";

type Chat = { choices?: { message?: { content?: string | null; reasoning_content?: string } }[] };

async function askJson<T>(ai: Ai, system: string, user: string): Promise<T> {
  const out = (await runAi(ai, CODE_MODEL, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    max_completion_tokens: 12000
  })) as Chat;
  const message = out.choices?.[0]?.message;
  const text = message?.content || message?.reasoning_content || "";
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as T;
}

const ADJUDICATE = `You decide disputed rules for a shared code library. Several independent agents wrote programs that interpret the same rule differently. Decide which reading is correct according to the reference document.

For each conflict:
- Pick the reading the reference document supports, and quote the exact sentence(s) you rely on (verbatim, short).
- If the document is silent, pick the reading most programs used and say "majority" as the citation.
- Write the decision as a precise, testable rule (e.g. "A fee rule field that is null or an empty list matches every value").
- Skip conflicts that are only about presentation (sort order, number formatting, variable names): omit them from rows.

Reply with JSON only:
{"rows": [{"conflict": <index>, "variant": <index of the winning variant>, "decision": string, "citation": string}]}`;

/** Decide each conflict; programs on losing variants become "losers". */
export async function adjudicate(
  ai: Ai,
  reference: string,
  conflicts: Conflict[],
  startId = 1
): Promise<LedgerRow[]> {
  if (!conflicts.length) return [];
  const user = `## Reference document\n${reference}\n\n## Conflicts\n${conflicts
    .map(
      (c, i) =>
        `${i}. ${c.about}\n${c.variants
          .map((v, j) => `   variant ${j} (used by ${v.programs.length} program(s)): ${v.description}`)
          .join("\n")}`
    )
    .join("\n")}`;
  const { rows } = await askJson<{ rows: { conflict: number; variant: number; decision: string; citation: string }[] }>(
    ai,
    ADJUDICATE,
    user
  );
  return rows
    .filter((r) => conflicts[r.conflict])
    .map((r, i) => ({
      id: `S${startId + i}`,
      about: conflicts[r.conflict]!.about,
      decision: r.decision,
      citation: r.citation,
      losers: conflicts[r.conflict]!.variants.filter((_, j) => j !== r.variant).flatMap((v) => v.programs),
      basis: /^\s*majority\s*$/i.test(r.citation) || !r.citation.trim() ? ("majority" as const) : ("cited" as const)
    }));
}

export type HelperTest = { helper: string; name: string; code: string };
export type TestResult = HelperTest & { ok: boolean; error?: string };

const WRITE_TESTS = `You write unit tests for helper functions in a shared library, from the reference document and the decided semantics, NOT from the helpers' current behaviour.

A test is an async arrow function returning true if the helper behaves correctly, e.g.
async () => { const r = await codemode.run("fee-field-matches", { field: "[]", value: "F" }); return r === true; }

Tests may call helpers with codemode.run(name, input) and may query the real dataset with data.sql({ query }) to set up expectations. Only use columns that exist in the dataset schema below. Prefer small, decisive cases that probe the decided semantics and edge cases from the document (empty lists, nulls, bucket boundaries, date ranges). Write 1-3 tests per helper that has semantics to check; skip helpers that only fetch data.

Reply with JSON only: {"tests": [{"helper": string, "name": string, "code": string}]}`;

export async function writeTests(
  ai: Ai,
  reference: string,
  ledger: LedgerRow[],
  helpers: Helper[],
  schema = ""
): Promise<HelperTest[]> {
  if (!helpers.length) return [];
  const user = `## Reference document\n${reference}\n\n## Dataset schema\n${schema || "(not provided)"}\n\n## Decided semantics\n${
    ledger.map((r) => `- ${r.id}: ${r.decision}`).join("\n") || "(none)"
  }\n\n## Helpers\n${helpers
    .map((h) => `### ${h.name}: ${h.description}\ninput schema: ${JSON.stringify(h.inputSchema ?? {})}\n\`\`\`js\n${h.code}\n\`\`\``)
    .join("\n\n")}`;
  const { tests } = await askJson<{ tests: HelperTest[] }>(ai, WRITE_TESTS, user);
  return (tests ?? []).filter((t) => helpers.some((h) => h.name === t.helper));
}

export async function runTests(
  executor: Executor,
  base: ResolvedProvider[],
  helpers: Helper[],
  tests: HelperTest[]
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const test of tests) {
    const out = await safeExecute(
      executor,
      `async () => await (${normalizeCode(test.code)})()`,
      withHelpers(executor, base, helpers)
    );
    const ok = !out.error && out.result === true;
    results.push({ ...test, ok, ...(ok ? {} : { error: out.error ?? `returned ${JSON.stringify(out.result)}` }) });
  }
  return results;
}
