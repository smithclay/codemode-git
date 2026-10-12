import { DurableObject } from "cloudflare:workers";
import { createCodemodeRuntime, DynamicWorkerExecutor } from "@cloudflare/codemode";
import { ArtifactsSink, GitHistoryConnector } from "@smithclay/codemode-git";
import { LampsConnector } from "./lamps";

// Code Mode's runtime facet class must be exported from the entry module.
export { CodemodeRuntime } from "@cloudflare/codemode";

type Env = {
  LOADER: WorkerLoader;
  ARTIFACTS: Artifacts;
  AGENT: DurableObjectNamespace<CodeAgent>;
  /** If set, every request must send `Authorization: Bearer <ADMIN_TOKEN>`. */
  ADMIN_TOKEN?: string;
};

/**
 * A stock Code Mode agent. The only codemode-git additions are the sink,
 * the GitHistoryConnector in the connector list, and `history.bind(...)`.
 */
export class CodeAgent extends DurableObject<Env> {
  // Kept per instance so the warm in-memory clone is reused across runs.
  #sink?: ArtifactsSink;

  #setup(agent: string) {
    this.#sink ??= new ArtifactsSink({
      artifacts: this.env.ARTIFACTS,
      repo: `agent-${agent}`,
      description: `Code Mode history for agent ${agent}`
    });
    const history = new GitHistoryConnector(this.ctx, this.env, { sink: this.#sink });
    const runtime = history.bind(
      createCodemodeRuntime({
        ctx: this.ctx,
        executor: new DynamicWorkerExecutor({ loader: this.env.LOADER }),
        connectors: [new LampsConnector(this.ctx, this.env), history]
      })
    );
    return { runtime, history };
  }

  async execute(agent: string, code: string) {
    return this.#setup(agent).runtime.execute({ code });
  }

  async commits(agent: string) {
    return this.#setup(agent).history.commits(20);
  }

  async flush(agent: string) {
    const { history } = this.#setup(agent);
    await history.flush();
    return history.commits(20);
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    if (env.ADMIN_TOKEN && request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
      return new Response("unauthorized", { status: 401 });
    }
    const match = /^\/agents\/([a-z0-9-]{1,48})\/(execute|commits|flush)$/.exec(new URL(request.url).pathname);
    if (!match) {
      return new Response(
        "POST /agents/:name/execute (body: code) | GET /agents/:name/commits | POST /agents/:name/flush\n",
        { status: 404 }
      );
    }
    const [, agent, action] = match as unknown as [string, string, string];
    const stub = env.AGENT.get(env.AGENT.idFromName(agent));

    if (action === "execute" && request.method === "POST") {
      return Response.json(await stub.execute(agent, await request.text()));
    }
    if (action === "commits" && request.method === "GET") {
      return Response.json(await stub.commits(agent));
    }
    if (action === "flush" && request.method === "POST") {
      return Response.json(await stub.flush(agent));
    }
    return new Response("method not allowed", { status: 405 });
  }
} satisfies ExportedHandler<Env>;
