// ReGAL-style skill mining: instead of declaring whole scripts "the same task"
// and merging them into one function, refactor a batch of agents' programs
// into small shared helpers, rewrite each program to call them, and keep a
// helper only if the rewritten programs that use it still reproduce their own
// original results. Disagreements between programs are reported, not papered
// over with option flags.
// (ReGAL: https://arxiv.org/abs/2401.16467; see docs/skill-formation-research.md)

import { normalizeCode, type Executor, type ResolvedProvider } from "@cloudflare/codemode";
import { FILES, parseTrailers, snippetsUsed, TRAILERS } from "codemode-git";
import { runAi } from "./ai";
import { CODE_MODEL } from "./generalize";
import { parseCalls, stableStringify, type CallRecord } from "./verify";

export type Program = {
  repo: string;
  sha: string;
  question: string;
  code: string;
  calls: CallRecord[];
  result: unknown;
};

export type Helper = { name: string; description: string; inputSchema?: unknown; code: string };

/** A rule the programs interpret differently, with which programs take which reading. */
export type Conflict = { about: string; variants: { description: string; programs: number[] }[] };

/** A decided interpretation (see ledger.ts). Programs on the losing side are not reproduced. */
export type LedgerRow = {
  id: string;
  about: string;
  decision: string;
  citation: string;
  /** Programs on a losing variant. Only enforced when the decision cites the reference. */
  losers: number[];
  /** "cited": backed by a quote from the reference. "majority": the reference was silent. */
  basis: "cited" | "majority";
};

export type RefactorProposal = { helpers: Helper[]; rewrites: string[]; conflicts: Conflict[] };

export type BatchReport = {
  programs: { repo: string; question: string }[];
  helpers: (Helper & { usedBy: number[]; passedBy: number[] })[];
  results: { program: number; ok: boolean; usesHelpers: string[]; error?: string; excluded?: string }[];
  conflicts: Conflict[];
  /** Characters of code before vs after (original programs, vs rewrites + helpers that were kept). */
  size: { before: number; after: number };
  error?: string;
};

/** Each agent's answer-producing run (the target of its Codemode-Final marker). */
export async function loadFinalPrograms(artifacts: Artifacts, repoPrefix: string): Promise<Program[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await artifacts.list({ limit: 100, cursor });
    names.push(...page.repos.map((r) => r.name).filter((n) => n.startsWith(repoPrefix)));
    cursor = page.cursor;
  } while (cursor);

  const programs: Program[] = [];
  for (const name of names) {
    const repo = await artifacts.get(name);
    try {
      const log = await repo.log({ limit: 200 });
      const marker = log.find((c) => parseTrailers(c.message)[TRAILERS.final]);
      if (!marker) continue;
      const prefix = parseTrailers(marker.message)[TRAILERS.final]!;
      const run = log.find((c) => c.hash.startsWith(prefix));
      if (!run) continue;
      const read = async (path: string) => (await repo.readFile({ ref: run.hash, path }))?.text() ?? "";
      const [code, calls, result] = await Promise.all([read(FILES.code), read(FILES.calls), read(FILES.result)]);
      if (snippetsUsed(code).length) continue; // already built on skills; mine from first-principles code
      programs.push({
        repo: name,
        sha: run.hash,
        question: run.message.split("\n")[0]!,
        code,
        calls: parseCalls(calls),
        result: (JSON.parse(result || "{}") as { result?: unknown }).result ?? null
      });
    } finally {
      repo[Symbol.dispose]();
    }
  }
  return programs;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Greedy grouping by embedding similarity (ReGAL clusters queries before refactoring). */
export function groupBySimilarity<T>(items: T[], vectors: number[][], threshold: number, maxSize: number): T[][] {
  const left = items.map((_, i) => i);
  const groups: T[][] = [];
  while (left.length) {
    const seed = left.shift()!;
    const members = [seed];
    left
      .map((i) => ({ i, s: cosine(vectors[seed]!, vectors[i]!) }))
      .filter((x) => x.s >= threshold)
      .sort((a, b) => b.s - a.s)
      .slice(0, maxSize - 1)
      .forEach((x) => {
        members.push(x.i);
        left.splice(left.indexOf(x.i), 1);
      });
    groups.push(members.map((i) => items[i]!));
  }
  return groups;
}

const SYSTEM = `You refactor programs written independently by different data-analysis agents into a small library of shared helper functions.

Each program is an async arrow function that calls connector globals (e.g. data.sql({ query, params })) and returns a value.

Produce:
1. helpers: small, single-purpose functions that capture computations the programs share (e.g. "monthly fraud rate for a merchant", "fee rules matching a transaction profile", "fee for one transaction"). Each is \`async (input) => { ... }\` taking ONE input object; it may call connector globals and other helpers via \`await codemode.run("helper-name", input)\`. Name helpers as kebab-case verbs.
2. rewrites: for EVERY program, in order, a rewritten version that calls the helpers via \`await codemode.run(name, input)\` and returns EXACTLY the same value as the original. Keep program-specific logic in the rewrite.
3. conflicts: where programs compute the "same" thing differently (e.g. one treats an empty list as "matches anything" and another does not, or they bucket a value differently), do NOT add an option or flag to a helper to reproduce both. Instead, keep that step inside the rewrites (or make the helper cover only the part they agree on) and list the disagreement: {"about": "<the rule in question>", "variants": [{"description": "<reading A>", "programs": [<0-based indices>]}, {"description": "<reading B>", "programs": [...]}]}.

Rules:
- Helpers must not have flags that switch between different semantics. Parameters are for values (merchant, month, ids), not behaviours.
- Prefer few, reusable helpers. A helper used by only one program is usually not worth it.
- Every helper must do real work: at least one connector call or a multi-step computation. No one-line wrappers (e.g. rounding a number).
- Deterministic code only. No fetch, no Date.now(), no Math.random().
- Await connector calls one at a time.

Reply with JSON only, no prose and no code fences:
{"helpers": [{"name": string, "description": string, "inputSchema": object, "code": string}], "rewrites": [string, ...], "conflicts": [...]}`;

function describe(batch: Program[]): string {
  return batch
    .map(
      (p, i) =>
        `### Program ${i} (${p.question})\n\`\`\`js\n${p.code.trim()}\n\`\`\`\nReturned: ${JSON.stringify(p.result).slice(0, 300)}`
    )
    .join("\n\n");
}

function ledgerText(ledger: LedgerRow[]): string {
  if (!ledger.length) return "";
  const losers = [...new Set(ledger.filter((r) => r.basis === "cited").flatMap((r) => r.losers))];
  return `\n\n## Decided semantics (helpers and rewrites MUST follow these)\n${ledger
    .map((r) => `- ${r.id}: ${r.decision} (manual: "${r.citation}")`)
    .join("\n")}${
    losers.length
      ? `\nPrograms ${losers.join(", ")} contradict a decision. Rewrite them to follow the decided semantics; they will NOT be checked against their old result.`
      : ""
  }`;
}

export async function proposeRefactor(
  ai: Ai,
  batch: Program[],
  feedback?: string,
  ledger: LedgerRow[] = []
): Promise<RefactorProposal> {
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: describe(batch) + ledgerText(ledger) + (feedback ? `\n\n${feedback}` : "") }
  ];
  const out = (await runAi(ai, CODE_MODEL, { messages, max_completion_tokens: 16000 })) as {
    choices?: { message?: { content?: string | null; reasoning_content?: string } }[];
  };
  const message = out.choices?.[0]?.message;
  const text = message?.content || message?.reasoning_content || "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const proposal = JSON.parse(json) as RefactorProposal;
  if (!Array.isArray(proposal.helpers) || !Array.isArray(proposal.rewrites)) throw new Error("malformed refactor proposal");
  if (proposal.rewrites.length !== batch.length) {
    throw new Error(`expected ${batch.length} rewrites, got ${proposal.rewrites.length}`);
  }
  proposal.conflicts ??= [];
  return proposal;
}

/** Executors may throw on code that fails to parse; treat that as a failed run, not a crashed batch. */
export async function safeExecute(executor: Executor, code: string, providers: ResolvedProvider[]) {
  try {
    return await executor.execute(code, providers);
  } catch (err) {
    return { result: undefined, error: err instanceof Error ? err.message.split("\n").slice(0, 2).join(" ") : String(err) };
  }
}

const wrap = (code: string, input: unknown) =>
  `async () => {\n  const fn = (${normalizeCode(code)});\n  return await fn(${JSON.stringify(input ?? null)});\n}`;

/** Base providers plus `codemode.run(name, input)` that runs helpers (which may call each other). */
export function withHelpers(executor: Executor, base: ResolvedProvider[], helpers: Helper[]): ResolvedProvider[] {
  const byName = new Map(helpers.map((h) => [h.name, h]));
  const providers: ResolvedProvider[] = [
    ...base,
    {
      name: "codemode",
      fns: {
        // Programs sometimes look helpers up before calling them.
        describe: async (...args: unknown[]) => {
          const helper = byName.get(String(args[0]));
          return helper ? { path: helper.name, description: helper.description, types: helper.inputSchema } : null;
        },
        search: async () => ({ results: helpers.map((h) => ({ path: h.name, kind: "snippet" })), total: helpers.length }),
        run: async (...args: unknown[]) => {
          const helper = byName.get(String(args[0]));
          if (!helper) throw new Error(`no helper "${String(args[0])}"`);
          const out = await safeExecute(executor, wrap(helper.code, args[1]), providers);
          if (out.error) throw new Error(`${helper.name}: ${out.error}`);
          return out.result;
        }
      }
    }
  ];
  return providers;
}

/** Verify each rewrite reproduces its own program's result; score helpers by verified use. */
export async function verifyRefactor(
  executor: Executor,
  baseProviders: (p: Program) => ResolvedProvider[],
  batch: Program[],
  proposal: RefactorProposal,
  ledger: LedgerRow[] = []
): Promise<BatchReport> {
  const results: BatchReport["results"] = [];
  for (const [i, program] of batch.entries()) {
    const rewrite = proposal.rewrites[i] ?? "";
    const usesHelpers = proposal.helpers.filter((h) => rewrite.includes(h.name)).map((h) => h.name);
    const contradicts = ledger.filter((r) => r.basis === "cited" && r.losers.includes(i)).map((r) => r.id);
    if (contradicts.length) {
      // Its original result follows a rejected reading; nothing to reproduce.
      results.push({ program: i, ok: false, usesHelpers, excluded: `contradicts ${contradicts.join(", ")}` });
      continue;
    }
    const out = await safeExecute(
      executor,
      `async () => await (${normalizeCode(rewrite)})()`,
      withHelpers(executor, baseProviders(program), proposal.helpers)
    );
    const ok = !out.error && stableStringify(out.result) === stableStringify(program.result);
    results.push({
      program: i,
      ok,
      usesHelpers,
      ...(ok ? {} : { error: out.error ?? `returned ${stableStringify(out.result).slice(0, 200)}` })
    });
  }
  const helpers = proposal.helpers.map((h) => ({
    ...h,
    usedBy: results.filter((r) => r.usesHelpers.includes(h.name)).map((r) => r.program),
    passedBy: results.filter((r) => r.ok && r.usesHelpers.includes(h.name)).map((r) => r.program)
  }));
  const kept = helpers.filter((h) => h.passedBy.length >= 2);
  const before = batch.reduce((n, p) => n + p.code.length, 0);
  const after =
    results.reduce((n, r) => n + (r.ok ? (proposal.rewrites[r.program] ?? "").length : batch[r.program]!.code.length), 0) +
    kept.reduce((n, h) => n + h.code.length, 0);
  return {
    programs: batch.map((p) => ({ repo: p.repo, question: p.question })),
    helpers,
    results,
    conflicts: proposal.conflicts,
    size: { before, after }
  };
}
