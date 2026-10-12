import { agentKey, Solver, type Env, type SolveRequest } from "./solver";

export { CodemodeRuntime } from "@cloudflare/codemode";
export { Solver };

type FullEnv = Env & {
  SOLVER: DurableObjectNamespace<Solver>;
  HARNESS_TOKEN?: string;
};

/** Fail closed: anything but local dev needs the harness token. */
function authorized(request: Request, env: FullEnv): boolean {
  const { hostname } = new URL(request.url);
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  return !!env.HARNESS_TOKEN && request.headers.get("authorization") === `Bearer ${env.HARNESS_TOKEN}`;
}

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,30}$/;

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
    const checks = await env.SOLVER.get(env.SOLVER.idFromName("selftest")).selfTest();
    const passed = checks.every((c) => c.ok);
    return Response.json({ passed, checks }, { status: passed ? 200 : 500 });
  }

  return new Response("POST /solve | POST /selftest\n", { status: 404 });
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
