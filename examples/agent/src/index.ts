import { DurableObject } from "cloudflare:workers";
import { createCodemodeRuntime, DynamicWorkerExecutor } from "@cloudflare/codemode";
import {
  ArtifactsSink,
  GitHistoryConnector,
  indexExample,
  retrieveExamples,
  TRAILERS,
  type Example,
  type GitHistoryOptions
} from "@smithclay/codemode-git";
import { exampleRef, MODEL, runLoop } from "./ask";
import { LampsConnector } from "./lamps";

// Code Mode's runtime facet class must be exported from the entry module.
export { CodemodeRuntime } from "@cloudflare/codemode";

type Env = {
  LOADER: WorkerLoader;
  ARTIFACTS: Artifacts;
  AGENT: DurableObjectNamespace<CodeAgent>;
  /** Workers AI: the chat model for `ask` and the embedding model for examples. */
  AI: Ai;
  /** Vectorize index of answer-producing runs, shared by every agent. */
  EXAMPLES: Vectorize;
  /** If set, every request must send `Authorization: Bearer <ADMIN_TOKEN>`. */
  ADMIN_TOKEN?: string;
};

/**
 * Lamp-wall agents share one examples scope in the Vectorize index unless a
 * request names its own, e.g. a run-unique one so a demo sees only its own runs.
 */
const DEFAULT_SCOPE = "lamps";
const SCOPE_PATTERN = /^[a-z0-9-]{1,64}$/;

/**
 * Example task id. `retrieveExamples` skips matches whose task equals
 * `excludeTask` and keeps one match per task, so keying by agent excludes all
 * of the asking agent's own runs and returns at most one run per other agent.
 */
const taskId = (agent: string) => `agent-${agent}`;

const retrieve = (env: Env, agent: string, question: string, scope: string) =>
  retrieveExamples({ ai: env.AI, index: env.EXAMPLES, scope, question, excludeTask: taskId(agent), k: 3 });

export type AskResult = {
  agent: string;
  question: string;
  /** null if the model ran out of steps without calling final_answer. */
  answer: string | null;
  steps: number;
  executions: number;
  errors: number;
  tokens: { input: number; output: number };
  /** Other agents' runs shown to the model (repo@sha12). */
  examples: string[];
  /** This ask's commits, oldest first. */
  commits: { sha: string | null; intent: string; status: string }[];
  /** Whether the answer-producing run was indexed as an example for other agents. */
  indexed: boolean;
};

/**
 * A stock Code Mode agent. The only codemode-git additions are the sink,
 * the GitHistoryConnector in the connector list, and `history.bind(...)`.
 */
export class CodeAgent extends DurableObject<Env> {
  // Kept per instance so the warm in-memory clone is reused across runs.
  #sink?: ArtifactsSink;

  #setup(agent: string, options: Omit<GitHistoryOptions, "sink"> = {}) {
    this.#sink ??= new ArtifactsSink({
      artifacts: this.env.ARTIFACTS,
      repo: `agent-${agent}`,
      description: `Code Mode history for agent ${agent}`
    });
    const history = new GitHistoryConnector(this.ctx, this.env, { ...options, sink: this.#sink });
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

  /** Answer a question with a model-driven Code Mode loop, shown other agents' runs as examples. */
  async ask(agent: string, question: string, useExamples: boolean, scope: string): Promise<AskResult> {
    const examples: Example[] = useExamples ? await retrieve(this.env, agent, question, scope) : [];
    const shown = examples.map(exampleRef);
    const { runtime, history } = this.#setup(agent, {
      describe: () => question.slice(0, 200),
      extraTrailers: (): Record<string, string> => (shown.length ? { [TRAILERS.examples]: shown.join(", ") } : {})
    });

    const loop = await runLoop({ ai: this.env.AI, runtime, question, examples, model: MODEL, maxSteps: 10 });

    // Push every run before reporting, so the response has real shas.
    await history.flush();
    const ids = new Set(loop.executionIds);
    const rows = history.commits(200).filter((c) => ids.has(c.execution_id));

    // The run the answer came from becomes an example for other agents.
    let indexed = false;
    const sha = rows.find((c) => c.execution_id === loop.answerExecutionId && c.sha)?.sha;
    if (loop.answer && sha) {
      const code = (await runtime.executions()).find((e) => e.id === loop.answerExecutionId)?.code;
      if (code) {
        try {
          await indexExample({
            ai: this.env.AI,
            index: this.env.EXAMPLES,
            scope,
            task: taskId(agent),
            repo: `agent-${agent}`,
            sha,
            question,
            code,
            ok: true
          });
          indexed = true;
        } catch (err) {
          console.error(`indexExample failed for agent-${agent}@${sha}`, err);
        }
      }
    }

    return {
      agent,
      question,
      answer: loop.answer || null,
      steps: loop.steps,
      executions: loop.executions,
      errors: loop.errors,
      tokens: loop.tokens,
      examples: shown,
      commits: rows.reverse().map((c) => ({ sha: c.sha, intent: c.intent, status: c.status })),
      indexed
    };
  }
}

const USAGE = `POST /agents/:name/execute (body: code)
POST /agents/:name/ask (body: {"question": "...", "useExamples"?: false, "scope"?: "lamps"})
GET  /agents/:name/examples?question=...[&scope=lamps] (what ask would retrieve)
GET  /agents/:name/commits
POST /agents/:name/flush
`;

export default {
  async fetch(request, env): Promise<Response> {
    if (env.ADMIN_TOKEN && request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
      return new Response("unauthorized", { status: 401 });
    }
    const url = new URL(request.url);
    const match = /^\/agents\/([a-z0-9-]{1,48})\/(execute|ask|examples|commits|flush)$/.exec(url.pathname);
    if (!match) return new Response(USAGE, { status: 404 });
    const [, agent, action] = match as unknown as [string, string, string];
    const stub = env.AGENT.get(env.AGENT.idFromName(agent));

    if (action === "execute" && request.method === "POST") {
      return Response.json(await stub.execute(agent, await request.text()));
    }
    if (action === "ask" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { question?: unknown; useExamples?: unknown; scope?: unknown } | null;
      const question = typeof body?.question === "string" ? body.question.trim() : "";
      if (!question || question.length > 1000) {
        return new Response('body must be {"question": "..."} (at most 1000 chars)\n', { status: 400 });
      }
      const scope = body?.scope ?? DEFAULT_SCOPE;
      if (typeof scope !== "string" || !SCOPE_PATTERN.test(scope)) {
        return new Response("scope must match [a-z0-9-]{1,64}\n", { status: 400 });
      }
      return Response.json(await stub.ask(agent, question, body?.useExamples !== false, scope));
    }
    if (action === "examples" && request.method === "GET") {
      const question = url.searchParams.get("question")?.trim();
      if (!question) return new Response("missing ?question=\n", { status: 400 });
      const scope = url.searchParams.get("scope") ?? DEFAULT_SCOPE;
      if (!SCOPE_PATTERN.test(scope)) return new Response("scope must match [a-z0-9-]{1,64}\n", { status: 400 });
      const examples = await retrieve(env, agent, question, scope);
      return Response.json(examples.map((e) => ({ ref: exampleRef(e), question: e.question, score: e.score })));
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
