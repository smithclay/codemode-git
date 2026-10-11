import { DurableObject } from "cloudflare:workers";
import { createCodemodeRuntime, DynamicWorkerExecutor } from "@cloudflare/codemode";
import { ArtifactsSink, GitHistoryConnector, syncSkills, TRAILERS, type SyncSkillsResult } from "codemode-git";
import { CatalogConnector } from "./catalog";

// The runtime facet class must be exported from the entry module. codemode-git's
// subclass adds installSnippet(), which syncSkills uses.
export { CodemodeRuntime } from "codemode-git";

const SKILLS_REFRESH_MS = 30_000;

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
  #skills?: { result: SyncSkillsResult; at: number };

  /** Pull the shared skill library into this agent's snippets (cached briefly). */
  async syncSkills(force = false): Promise<SyncSkillsResult> {
    if (!force && this.#skills && Date.now() - this.#skills.at < SKILLS_REFRESH_MS) return this.#skills.result;
    const result = await syncSkills({ ctx: this.ctx, artifacts: this.env.ARTIFACTS, connectors: ["catalog"] });
    this.#skills = { result, at: Date.now() };
    return result;
  }

  #setup(agent: string) {
    this.#sink ??= new ArtifactsSink({
      artifacts: this.env.ARTIFACTS,
      repo: `agent-${agent}`,
      description: `Code Mode history for agent ${agent}`
    });
    const history = new GitHistoryConnector(this.ctx, this.env, {
      sink: this.#sink,
      // Record which version of the skill library this run could see.
      extraTrailers: (): Record<string, string> =>
        this.#skills?.result.sha ? { [TRAILERS.skillsRef]: this.#skills.result.sha } : {}
    });
    const runtime = history.bind(
      createCodemodeRuntime({
        ctx: this.ctx,
        executor: new DynamicWorkerExecutor({ loader: this.env.LOADER }),
        connectors: [new CatalogConnector(this.ctx, this.env), history]
      })
    );
    return { runtime, history };
  }

  async execute(agent: string, code: string) {
    await this.syncSkills();
    return this.#setup(agent).runtime.execute({ code });
  }

  async snippets(agent: string) {
    await this.syncSkills(true);
    return this.#setup(agent).runtime.snippets();
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
    const match = /^\/agents\/([a-z0-9-]{1,48})\/(execute|commits|flush|snippets)$/.exec(new URL(request.url).pathname);
    if (!match) {
      return new Response(
        "POST /agents/:name/execute (body: code) | GET /agents/:name/commits | GET /agents/:name/snippets | POST /agents/:name/flush\n",
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
    if (action === "snippets" && request.method === "GET") {
      return Response.json(await stub.snippets(agent));
    }
    if (action === "flush" && request.method === "POST") {
      return Response.json(await stub.flush(agent));
    }
    return new Response("method not allowed", { status: 405 });
  }
} satisfies ExportedHandler<Env>;
