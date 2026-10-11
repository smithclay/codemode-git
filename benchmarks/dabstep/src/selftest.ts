// Harness self-test: exercises the refactor/ledger/replay mechanics with
// canned inputs against the real sandbox and real D1. No model calls, so it
// is fast and free. Run it before any paid experiment:
//   curl -X POST localhost:8789/selftest
import type { DynamicWorkerExecutor, ResolvedProvider } from "@cloudflare/codemode";
import { replay, fixtureProviders, type CallRecord } from "codemode-git-curator/verify";
import { safeExecute, verifyRefactor, withHelpers, type LedgerRow, type Program } from "codemode-git-curator/refactor";
import { runTests } from "codemode-git-curator/ledger";
import { indexExample, retrieveExamples } from "codemode-git";

type Check = { name: string; ok: boolean; detail?: string };

export async function selfTest(
  executor: DynamicWorkerExecutor,
  live: ResolvedProvider[],
  vectors?: { ai: Ai; index: Vectorize }
): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    checks.push({ name, ok, ...(ok ? {} : { detail: JSON.stringify(detail)?.slice(0, 300) }) });

  // Ground truth computed directly, to compare against.
  const direct = await safeExecute(
    executor,
    `async () => (await data.sql({ query: "SELECT COUNT(*) AS n FROM payments WHERE merchant = 'Rafa_AI'" })).rows[0].n`,
    live
  );
  check("live data connector works in the sandbox", typeof direct.result === "number" && direct.result > 0, direct);

  const program: Program = {
    repo: "selftest",
    sha: "0",
    question: "count Rafa_AI payments",
    code: "",
    calls: [],
    result: direct.result
  };
  const helper = {
    name: "count-merchant-payments",
    description: "Count a merchant's payments",
    code: `async (input) => (await data.sql({ query: "SELECT COUNT(*) AS n FROM payments WHERE merchant = ?", params: [input.merchant] })).rows[0].n`
  };
  const good = `async () => await codemode.run("count-merchant-payments", { merchant: "Rafa_AI" })`;
  const wrong = `async () => await codemode.run("count-merchant-payments", { merchant: "Crossfit_Hanna" })`;
  const broken = `async () => { return codemode.run("count-merchant-payments", { merchant: "Rafa_AI" }) ))) }`;
  const twoPrograms = [program, { ...program, sha: "1" }];

  const r1 = await verifyRefactor(executor, () => live, twoPrograms, { helpers: [helper], rewrites: [good, good], conflicts: [] });
  check("correct rewrite verifies; helper kept by 2 verified uses", r1.results.every((r) => r.ok) && r1.helpers[0]!.passedBy.length === 2, r1.results);

  const r2 = await verifyRefactor(executor, () => live, twoPrograms, { helpers: [helper], rewrites: [good, wrong], conflicts: [] });
  check("wrong rewrite fails verification", r2.results[0]!.ok && !r2.results[1]!.ok, r2.results);

  const r3 = await verifyRefactor(executor, () => live, twoPrograms, { helpers: [helper], rewrites: [good, broken], conflicts: [] });
  check("unparseable code is a failed result, not a crash", r3.results[0]!.ok && !r3.results[1]!.ok && !!r3.results[1]!.error, r3.results);

  const cited: LedgerRow = { id: "S1", about: "x", decision: "x", citation: "quoted text", losers: [1], basis: "cited" };
  const majority: LedgerRow = { ...cited, id: "S2", citation: "majority", basis: "majority" };
  const r4 = await verifyRefactor(executor, () => live, twoPrograms, { helpers: [helper], rewrites: [good, wrong], conflicts: [] }, [cited]);
  check("cited ledger row excludes its losing program", r4.results[1]!.excluded?.includes("S1") === true, r4.results);
  const r5 = await verifyRefactor(executor, () => live, twoPrograms, { helpers: [helper], rewrites: [good, wrong], conflicts: [] }, [majority]);
  check("majority-only ledger row does not exclude", !r5.results[1]!.excluded && !r5.results[1]!.ok, r5.results);

  const tests = await runTests(executor, live, [helper], [
    {
      helper: helper.name,
      name: "matches a direct query",
      code: `async () => { const d = (await data.sql({ query: "SELECT COUNT(*) AS n FROM payments WHERE merchant = 'Rafa_AI'" })).rows[0].n; return (await codemode.run("count-merchant-payments", { merchant: "Rafa_AI" })) === d; }`
    },
    { helper: helper.name, name: "bad column", code: `async () => (await data.sql({ query: "SELECT status FROM payments LIMIT 1" })).rows.length > 0` },
    { helper: helper.name, name: "syntax error", code: `async () => { return ((( }` }
  ]);
  check("tests can query data and call helpers", tests[0]!.ok, tests[0]);
  check("a test with a bad column fails cleanly", !tests[1]!.ok && !!tests[1]!.error, tests[1]);
  check("a test that fails to parse fails cleanly", !tests[2]!.ok && !!tests[2]!.error, tests[2]);

  const describe = await safeExecute(
    executor,
    `async () => (await codemode.describe("count-merchant-payments")).description`,
    withHelpers(executor, live, [helper])
  );
  check("codemode.describe works inside verification", describe.result === helper.description, describe);

  // The current curator's replay (recorded fixtures) still works.
  const calls: CallRecord[] = [{ connector: "data", method: "sql", args: { query: "SELECT 1 AS one" }, result: { rows: [{ one: 1 }] } }];
  const rep = await replay(executor, `async () => (await data.sql({ query: "SELECT 1 AS one" })).rows[0].one`, { input: null, calls, expected: 1 }, fixtureProviders(calls));
  check("fixture replay reproduces a recorded run", rep.ok, rep);

  // Examples layer: index two runs under a throwaway scope, retrieve, clean up.
  if (vectors) {
    const scope = `selftest-${crypto.randomUUID().slice(0, 8)}`;
    const shaA = crypto.randomUUID().replaceAll("-", "").slice(0, 32);
    const shaB = crypto.randomUUID().replaceAll("-", "").slice(0, 32);
    const base = { ...vectors, scope, repo: "selftest" };
    await indexExample({ ...base, task: "a", sha: shaA, ok: true, question: "What is the total fee Rafa_AI paid in March 2023?", code: "async () => { /* sum fees for Rafa_AI in March */ }" });
    await indexExample({ ...base, task: "b", sha: shaB, ok: false, question: "What is the total fee Crossfit_Hanna paid in May 2023?", code: "async () => { /* sum fees for Crossfit_Hanna in May */ }" });
    let found: Awaited<ReturnType<typeof retrieveExamples>> = [];
    // Vectorize is eventually consistent: a new vector is queryable after ~30s,
    // but filterable by metadata only after ~1-2 minutes.
    for (let i = 0; i < 40 && !found.length; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      found = await retrieveExamples({ ...vectors, scope, question: "Total fees Golfclub_Baron_Friso paid in June 2023?", excludeTask: "zzz" });
    }
    check("a similar question retrieves the indexed example", found.length === 1 && found[0]!.sha === shaA, found);
    check("examples marked not-ok are never retrieved", !found.some((e) => e.sha === shaB), found);
    const own = await retrieveExamples({ ...vectors, scope, question: "Total fees Rafa_AI paid in March 2023?", excludeTask: "a" });
    check("an agent's own task is excluded", !own.some((e) => e.task === "a"), own);
    await vectors.index.deleteByIds([shaA, shaB]);
  }

  return checks;
}
