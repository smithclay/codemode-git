import { Curator } from "codemode-git-curator/curator";
import { DabstepConnector } from "./connector";
import { agentRepo, skillsRepo, Solver, type Env, type SolveRequest } from "./solver";

export { CodemodeRuntime } from "codemode-git";
export { Solver };

/** The curator for a benchmark run. Verifies skills against the live (static) dataset. */
export class DabstepCurator extends Curator<Env> {
  protected override liveConnectors() {
    return [new DabstepConnector(this.ctx, this.env)];
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

export default {
  async fetch(request, env): Promise<Response> {
    if (!authorized(request, env)) return new Response("unauthorized", { status: 401 });
    const url = new URL(request.url);

    // One task, one fresh agent.
    if (url.pathname === "/solve" && request.method === "POST") {
      const req = (await request.json()) as SolveRequest;
      if (!RUN_ID.test(req.run)) return new Response("bad run id", { status: 400 });
      const id = env.SOLVER.idFromName(`${req.run}/${req.arm}/${req.task.task_id}`);
      return Response.json(await env.SOLVER.get(id).solve(req));
    }

    // Curator for a run: POST /curate/<run>/backfill, GET /curate/<run>/status
    const match = /^\/curate\/([a-z0-9-]+)\/(backfill|status)$/.exec(url.pathname);
    if (match) {
      const [, run, action] = match as unknown as [string, string, string];
      if (!RUN_ID.test(run)) return new Response("bad run id", { status: 400 });
      const stub = curator(env, run);
      await stub.configure({ repoPrefix: agentRepo(run, ""), skillsRepo: skillsRepo(run) });
      if (action === "backfill" && request.method === "POST") return Response.json(await stub.backfill());
      if (action === "status") return Response.json(await stub.status());
    }

    return new Response("POST /solve | POST /curate/:run/backfill | GET /curate/:run/status\n", { status: 404 });
  }
} satisfies ExportedHandler<FullEnv>;
