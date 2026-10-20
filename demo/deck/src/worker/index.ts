import { DurableObject } from "cloudflare:workers";
import { createCodemodeRuntime, DynamicWorkerExecutor } from "@cloudflare/codemode";
import { ArtifactsSink, GitHistoryConnector } from "@smithclay/codemode-git";
import { outline } from "../outline";
import type { Slide } from "../spec";
import { accessUser } from "./access";
import { MODEL, runTurn, type Effort, type Turn } from "./agent";
import { SlidesConnector, SlidesRepo } from "./slides";

// Code Mode's runtime facet class must be exported from the entry module.
export { CodemodeRuntime } from "@cloudflare/codemode";

type Env = {
  LOADER: WorkerLoader;
  ARTIFACTS: Artifacts;
  DECK: DurableObjectNamespace<DeckAgent>;
  AI: Ai;
  /**
   * Who may edit (talk to the agent, which spends tokens and runs model-written
   * code): anyone the Cloudflare Access app for /edit and /api/agent lets
   * through. Without these, only requests to localhost (local dev) may edit.
   */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};

/** Who is editing, or null for a viewer. */
async function editor(request: Request, env: Env): Promise<string | null> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) return accessUser(request, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  // No Access configured: never let a deployed deck be edited by anyone who finds it.
  return ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname) ? "local" : null;
}

/** The slides themselves: one program per slide. */
const SLIDES_REPO = "deck-slides";
/** The agent's own Code Mode history: every program it ran, via GitHistoryConnector. */
const AGENT_REPO = "deck-agent";
/** Earlier turns the agent sees: enough for "make it bigger" to mean something. */
const HISTORY_TURNS = 8;

export type DeckSlide = { id: string; prompt: string; notes: string; slide: Slide | null; sha: string | null; updatedAt: string | null };
export type Deck = { model: string; repo: string; agentRepo: string; slides: DeckSlide[] };
export type AgentReply = { reply: string; changed: string[]; steps: number; executions: number; errors: number; tokens: number; commits: string[] };

/** One Durable Object owns the deck, so each repo has exactly one writer. */
export class DeckAgent extends DurableObject<Env> {
  readonly #executor: DynamicWorkerExecutor;
  readonly #slides: SlidesRepo;
  readonly #historySink: ArtifactsSink;
  #busy = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS turns (n INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL)");
    this.#executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const sink = new ArtifactsSink({ artifacts: env.ARTIFACTS, repo: SLIDES_REPO, description: "Slide programs for the codemode-git deck" });
    this.#slides = new SlidesRepo(ctx.storage.sql, sink);
    this.#historySink = new ArtifactsSink({ artifacts: env.ARTIFACTS, repo: AGENT_REPO, description: "Code Mode history of the codemode-git deck agent" });
  }

  async deck(): Promise<Deck> {
    await this.#slides.hydrate();
    const prompts = new Map(outline.map((s) => [s.id, s]));
    const slides = this.#slides.order().map((id) => {
      const s = this.#slides.get(id);
      return { id, prompt: prompts.get(id)?.prompt ?? "", notes: prompts.get(id)?.notes ?? "", slide: s?.slide ?? null, sha: s?.sha ?? null, updatedAt: s?.updatedAt ?? null };
    });
    return { model: MODEL, repo: SLIDES_REPO, agentRepo: AGENT_REPO, slides };
  }

  turns(): Turn[] {
    return this.ctx.storage.sql.exec<Turn>("SELECT role, content FROM turns ORDER BY n").toArray();
  }

  /** Start the conversation over and reload the slides from the repo. */
  reset() {
    this.ctx.storage.sql.exec("DELETE FROM turns");
    this.#slides.reload();
  }

  async message(message: string, current?: string, effort?: Effort): Promise<AgentReply | { error: string; status: number }> {
    if (this.#busy) return { error: "the agent is still working on the last request", status: 409 };
    this.#busy = true;
    try {
      await this.#slides.hydrate();
      const before = new Map(this.#slides.order().map((id) => [id, this.#slides.get(id)?.sha ?? null]));

      const history = new GitHistoryConnector(this.ctx, this.env, { sink: this.#historySink, describe: () => message.slice(0, 200) });
      const runtime = history.bind(
        createCodemodeRuntime({
          ctx: this.ctx,
          executor: this.#executor,
          connectors: [new SlidesConnector(this.ctx, this.env, this.#slides, this.#executor, message), history]
        })
      );
      const turns = this.turns().slice(-HISTORY_TURNS);
      const slide = current ? { id: current, prompt: outline.find((s) => s.id === current)?.prompt } : undefined;
      const run = await runTurn({ ai: this.env.AI, runtime, history: turns, message, current: slide, effort });
      await history.flush();

      this.ctx.storage.sql.exec("INSERT INTO turns (role, content) VALUES ('user', ?), ('assistant', ?)", message, run.reply);
      const runs = new Set(run.executionIds);
      const commits = history.commits(200).filter((c) => runs.has(c.execution_id) && c.sha).map((c) => c.sha!.slice(0, 12));
      // Added, edited and removed slides.
      const ids = new Set([...before.keys(), ...this.#slides.order()]);
      const changed = [...ids].filter((id) => (this.#slides.get(id)?.sha ?? null) !== (before.get(id) ?? null));
      return { reply: run.reply, changed, steps: run.steps, executions: run.executions, errors: run.errors, tokens: run.tokens.input + run.tokens.output, commits };
    } finally {
      this.#busy = false;
    }
  }
}

const agent = (env: Env) => env.DECK.get(env.DECK.idFromName("deck"));

const USAGE = `GET  /api/deck                  the slides, rendered from the ${SLIDES_REPO} repo
GET  /edit?slide=<n>            sign in (Cloudflare Access), then back to the deck in edit mode
GET  /api/agent/me              who is editing; 401 for viewers
GET  /api/agent                 the conversation with the deck agent
POST /api/agent                 {"message": "...", "current"?: "<slide id>", "effort"?: "low" | "high"}
POST /api/agent/reset           start the conversation over and reload the slides from the repo
`;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/deck" && request.method === "GET") return Response.json(await agent(env).deck());
    // Access signs the user in on the way here; the deck takes it from there.
    if (url.pathname === "/edit") {
      const n = Number(url.searchParams.get("slide"));
      return Response.redirect(new URL(n > 0 ? `/#${n}` : "/", url).toString(), 302);
    }

    if (!url.pathname.startsWith("/api/agent")) return new Response(USAGE, { status: 404 });
    const who = await editor(request, env);
    if (!who) return new Response("unauthorized", { status: 401 });
    if (url.pathname === "/api/agent/me" && request.method === "GET") return Response.json({ editor: who });
    if (url.pathname === "/api/agent" && request.method === "GET") return Response.json(await agent(env).turns());
    if (url.pathname === "/api/agent/reset" && request.method === "POST") {
      await agent(env).reset();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/agent" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { message?: unknown; current?: unknown; effort?: unknown } | null;
      const message = typeof body?.message === "string" ? body.message.trim() : "";
      if (!message || message.length > 2000) return new Response('body must be {"message": "..."} (at most 2000 chars)\n', { status: 400 });
      const current = typeof body?.current === "string" ? body.current : undefined;
      const effort = body?.effort === "high" ? "high" : "low";
      try {
        const out = await agent(env).message(message, current, effort);
        return "error" in out ? Response.json({ error: out.error }, { status: out.status }) : Response.json(out);
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
      }
    }
    return new Response(USAGE, { status: 404 });
  }
} satisfies ExportedHandler<Env>;
