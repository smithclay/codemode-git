import { Curator } from "codemode-git-curator/curator";
import { DabstepConnector } from "./connector";
import { selfTest } from "./selftest";
import { agentKey, agentRepo, skillsRepo, Solver, type Env, type SolveRequest } from "./solver";

export { CodemodeRuntime } from "codemode-git";
export { Solver };

/** The curator for a benchmark run. Verifies skills against the live (static) dataset. */
export class DabstepCurator extends Curator<Env> {
  protected override liveConnectors() {
    return [new DabstepConnector(this.ctx, this.env)];
  }

  /** Harness self-test (see selftest.ts): canned inputs, real sandbox and D1, no model calls. */
  async selfTest() {
    return selfTest(this.executor, await this.liveProvidersForTests());
  }

  protected override async referenceDocs() {
    const row = await this.env.DB.prepare("SELECT content FROM documents WHERE name = 'manual.md'").first<{ content: string }>();
    return row?.content ?? "";
  }
}

type FullEnv = Env & {
  SOLVER: DurableObjectNamespace<Solver>;
  CURATOR: DurableObjectNamespace<DabstepCurator>;
  HARNESS_TOKEN?: string;
};

/** Fail closed: anything but local dev needs the harness token. */
function authorized(request: Request, env: FullEnv): boolean {
  const { hostname } = new URL(request.url);
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  return !!env.HARNESS_TOKEN && request.headers.get("authorization") === `Bearer ${env.HARNESS_TOKEN}`;
}

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,30}$/;

function curator(env: FullEnv, run: string) {
  return env.CURATOR.get(env.CURATOR.idFromName(run));
}

async function route(request: Request, env: FullEnv): Promise<Response> {
  const url = new URL(request.url);

  // One task, one fresh agent.
  if (url.pathname === "/solve" && request.method === "POST") {
    const req = (await request.json()) as SolveRequest;
    if (!RUN_ID.test(req.run)) return new Response("bad run id", { status: 400 });
    const id = env.SOLVER.idFromName(`${req.run}/${req.arm}/${agentKey(req)}`);
    return Response.json(await env.SOLVER.get(id).solve(req));
  }

  if (url.pathname === "/selftest" && request.method === "POST") {
    const checks = await env.CURATOR.get(env.CURATOR.idFromName("selftest")).selfTest();
    return Response.json({ passed: checks.every((c) => c.ok), checks }, { status: checks.every((c) => c.ok) ? 200 : 500 });
  }

  // Prototype (read-only): refactor a run's answer-producing programs into
  // shared helpers. Separate curator instance; publishes nothing.
  const proto = /^\/prototype\/refactor\/([a-z0-9-]+)$/.exec(url.pathname);
  if (proto && request.method === "POST") {
    const run = proto[1]!;
    const opts = (await request.json().catch(() => ({}))) as {
      threshold?: number;
      batchSize?: number;
      only?: number;
      ledger?: boolean;
    };
    const stub = env.CURATOR.get(
      env.CURATOR.idFromName(`prototype:${run}:${opts.ledger ? "ledger" : "plain"}:${opts.batchSize ?? 3}:${opts.only ?? "all"}`)
    );
    return Response.json(await stub.prototypeRefactor({ repoPrefix: agentRepo(run, ""), ...opts }));
  }

  // Curator for a run: POST /curate/<run>/backfill, GET /curate/<run>/status
  const match = /^\/curate\/([a-z0-9-]+)\/(backfill|status)$/.exec(url.pathname);
  if (match) {
    const [, run, action] = match as unknown as [string, string, string];
    if (!RUN_ID.test(run)) return new Response("bad run id", { status: 400 });
    const stub = curator(env, run);
    // Learn from the run each agent answered with, and promote once two
    // independent agents converge on the same computation.
    await stub.configure(
      { repoPrefix: agentRepo(run, ""), skillsRepo: skillsRepo(run) },
      { finalRunsOnly: true, minRepos: 2 }
    );
    if (action === "backfill" && request.method === "POST") return Response.json(await stub.backfill());
    if (action === "status") return Response.json(await stub.status());
  }

  return new Response("POST /solve | POST /curate/:run/backfill | GET /curate/:run/status\n", { status: 404 });
}

export default {
  async fetch(request, env): Promise<Response> {
    if (!authorized(request, env)) return new Response("unauthorized", { status: 401 });
    try {
      return await route(request, env);
    } catch (err) {
      // Give the runner the real cause instead of an HTML error page.
      const error = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      console.error("dabstep harness:", error);
      return Response.json({ error: error.slice(0, 4000) }, { status: 500 });
    }
  }
} satisfies ExportedHandler<FullEnv>;
