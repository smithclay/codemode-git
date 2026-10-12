// Harness self-test: the agents' real Code Mode runtime against real D1, and
// an examples round trip through real Vectorize. No chat-model calls, so it is
// fast and nearly free. Run it before any paid experiment:
//   curl -X POST localhost:8789/selftest
import type { createCodemodeRuntime } from "@cloudflare/codemode";
import { indexExample, retrieveExamples } from "codemode-git";

type Check = { name: string; ok: boolean; detail?: string };

export async function selfTest(
  runtime: ReturnType<typeof createCodemodeRuntime>,
  vectors: { ai: Ai; index: Vectorize }
): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    checks.push({ name, ok, ...(ok ? {} : { detail: JSON.stringify(detail)?.slice(0, 300) }) });
  const run = async (code: string) => runtime.execute({ code });

  const count = await run(
    `async () => (await data.sql({ query: "SELECT COUNT(*) AS n FROM payments WHERE merchant = 'Rafa_AI'" })).rows[0].n`
  );
  check(
    "data.sql works in the sandbox",
    count.status === "completed" && typeof count.result === "number" && count.result > 0,
    count
  );

  const bare = await run(`async () => (await data.sql("SELECT 1 AS one")).rows[0].one`);
  check("data.sql accepts a bare query string", bare.status === "completed" && bare.result === 1, bare);

  const manual = await run(`async () => (await data.doc("manual.md")).length`);
  check(
    "data.doc returns the whole manual",
    manual.status === "completed" && typeof manual.result === "number" && manual.result > 20_000,
    manual
  );

  const write = await run(`async () => await data.sql({ query: "DELETE FROM payments" })`);
  check("data.sql rejects writes", write.status !== "completed", write);

  const broken = await run(`async () => { return ((( }`);
  check("unparseable code is an error result, not a crash", broken.status !== "completed", broken);

  // Examples layer: index two runs under a throwaway scope, retrieve, clean up.
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

  return checks;
}
