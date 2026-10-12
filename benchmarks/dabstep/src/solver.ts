import { DurableObject } from "cloudflare:workers";
import { createCodemodeRuntime, DynamicWorkerExecutor, type CodemodeConnector } from "@cloudflare/codemode";
import {
  ArtifactsSink,
  GitHistoryConnector,
  indexExample,
  retrieveExamples,
  toFinalCommit,
  TRAILERS,
  type Example
} from "codemode-git";
import { runAi } from "./ai";
import { DabstepConnector, SCHEMA } from "./connector";
import { selfTest } from "./selftest";

export type Env = {
  DB: D1Database;
  /** Vectorize index of answer-producing runs (the codemode-git-examples arm). */
  EXAMPLES: Vectorize;
  ARTIFACTS: Artifacts;
  AI: Ai;
  LOADER: WorkerLoader;
};

/**
 * baseline: stock Code Mode.
 * codemode-git-examples: + per-agent git history + other agents' answer-producing runs as examples.
 * (The curated-skills arm, "codemode-git", was dropped after tpl36b; see docs/experiments.md.)
 */
export type Arm = "baseline" | "codemode-git-examples";

export type Task = { task_id: string; question: string; guidelines: string; level: string };

export type SolveRequest = {
  run: string;
  arm: Arm;
  task: Task;
  model: string;
  maxSteps?: number;
  /** Independent repetition of the same task (0-based). Each gets its own agent and repo. */
  repeat?: number;
  /** Retry number after an infrastructure failure (1-based). Each gets its own agent and repo. */
  attempt?: number;
};

/** One agent per (task, repeat, attempt): its Durable Object name and repo suffix. */
export function agentKey(req: Pick<SolveRequest, "task" | "repeat" | "attempt">): string {
  return `${req.task.task_id}${req.repeat ? `-r${req.repeat}` : ""}${req.attempt && req.attempt > 1 ? `-a${req.attempt}` : ""}`;
}

export type SolveResult = {
  task_id: string;
  repeat: number;
  /** Ran out of steps without calling final_answer. */
  exhausted: boolean;
  arm: Arm;
  model: string;
  answer: string;
  steps: number;
  executions: number;
  errors: number;
  tokens: { input: number; output: number };
  /** Example runs (repo@sha) shown to the agent (codemode-git-examples arm). */
  examplesOffered: string[];
  ms: number;
  /** Assistant/user turns after the system prompt, clipped. For debugging failures. */
  transcript: { role: string; content: string }[];
};

export const agentRepo = (run: string, key: string, arm: Arm) => `${run}-${arm}-t${key}`;

// The manual is ~22k chars; agents must be able to read it whole.
const MAX_FEEDBACK_CHARS = 24_000;

function examplesText(examples: Example[]): string {
  if (!examples.length) return "";
  return `\n## How other agents approached similar questions\nUnverified code other agents ran to answer related questions. Their interpretations may be wrong: check every rule against the manual before relying on it.\n${examples
    .map((e) => `### ${e.question} (${e.repo}@${e.sha.slice(0, 7)})\n\`\`\`js\n${e.code.trim()}\n\`\`\``)
    .join("\n\n")}\n`;
}

function systemPrompt(examples: Example[]): string {
  return `You are a data analyst agent. You answer a question about a payments dataset by writing JavaScript that runs in a sandbox.

## How to work
Call the \`codemode\` tool with an async arrow function, e.g.
async () => { const { rows } = await data.sql({ query: "SELECT COUNT(*) AS n FROM payments" }); return rows; }
You get back its return value or error. Repeat as needed. When you are confident, call \`final_answer\`.

## Sandbox
The only global you need is \`data\` (plus standard JavaScript; no fetch, no imports, no Node APIs). It has exactly two methods:
- \`await data.sql({ query, params })\` runs one read-only SQLite query and returns \`{ rows }\` (max 5000 rows — aggregate in SQL).
- \`await data.doc({ name })\` returns "manual.md" or "payments-readme.md" as text.

${SCHEMA}

## Rules
- Read the manual before answering fee, fraud or volume questions; its definitions are authoritative.
- Prefer computing in SQL. Return compact values from code, not raw tables.
- Follow the answer guidelines exactly (format, rounding, units). If the question has no applicable answer, answer "Not Applicable".
- final_answer takes only the answer value in the requested format: no explanation, markdown, units or currency unless the guidelines ask for them.
${examplesText(examples)}`;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "codemode",
      description: "Run JavaScript in the sandbox. `code` is an async arrow function; its return value comes back to you.",
      parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] }
    }
  },
  {
    type: "function",
    function: {
      name: "final_answer",
      description: "Submit only the final answer value, formatted exactly as the answer guidelines require. No explanation or markdown.",
      parameters: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] }
    }
  }
];

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type Action = { kind: "code"; code: string; callId?: string } | { kind: "answer"; answer: string; callId?: string };

async function chat(ai: Ai, model: string, messages: ChatMessage[]) {
  const out = (await runAi(ai, model, {
    messages,
    tools: TOOLS,
    max_completion_tokens: 8000
  })) as {
    choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
    response?: string;
    tool_calls?: { name: string; arguments: unknown }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = out.choices?.[0]?.message;
  let toolCalls = message?.tool_calls ?? [];
  // Older Workers AI response shape.
  if (!toolCalls.length && out.tool_calls?.length) {
    toolCalls = out.tool_calls.map((c, i) => ({
      id: `call_${i}`,
      type: "function",
      function: { name: c.name, arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments) }
    }));
  }
  return {
    text: message?.content ?? out.response ?? "",
    toolCalls,
    input: out.usage?.prompt_tokens ?? 0,
    output: out.usage?.completion_tokens ?? 0
  };
}

export function parseArgs(raw: unknown): Record<string, string> {
  // Some models' tool-call arguments arrive already parsed.
  if (raw && typeof raw === "object") return raw as Record<string, string>;
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** What the model wants to do: from tool calls, or from text if it didn't use them. */
export function actionsFrom(text: string, toolCalls: ToolCall[]): Action[] {
  const actions: Action[] = [];
  for (const call of toolCalls) {
    const args = parseArgs(call.function.arguments);
    if (call.function.name === "final_answer" && args.answer !== undefined) {
      actions.push({ kind: "answer", answer: String(args.answer), callId: call.id });
    } else if (args.code) {
      actions.push({ kind: "code", code: args.code, callId: call.id });
    }
  }
  if (actions.length) return actions;
  // Fallbacks: a fenced code block, raw tool-call tokens some models emit as text, or "FINAL ANSWER:".
  const fenced = /```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/.exec(text);
  if (fenced) return [{ kind: "code", code: fenced[1]!.trim() }];
  const raw = /<\|tool_call_argument_begin\|>\s*(\{[\s\S]*?\})\s*<\|tool_call_end\|>/.exec(text);
  if (raw) {
    const args = parseArgs(raw[1]!);
    if (args.code) return [{ kind: "code", code: args.code }];
    if (args.answer !== undefined) return [{ kind: "answer", answer: String(args.answer) }];
  }
  const final = /FINAL ANSWER:\s*(.+)/i.exec(text);
  if (final) return [{ kind: "answer", answer: final[1]!.trim() }];
  return [];
}

/** Answers are scored by near-exact match; prose or markdown in one is always wrong. */
export function malformedAnswer(answer: string): boolean {
  return /\n|\*\*|```|^#/.test(answer.trim()) || answer.trim().length > 1000;
}

export function clip(value: unknown): string {
  // JSON.stringify(undefined) is undefined: code that returns nothing.
  // SQLite integers can come back as BigInt, which JSON.stringify rejects.
  const text =
    typeof value === "string"
      ? value
      : (JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)) ?? String(value));
  return text.length > MAX_FEEDBACK_CHARS ? `${text.slice(0, MAX_FEEDBACK_CHARS)}… (truncated, ${text.length} chars)` : text;
}

/** One agent, one task. */
export class Solver extends DurableObject<Env> {
  /** Harness self-test (see selftest.ts): the agents' real runtime, D1 and Vectorize; no chat-model calls. */
  async selfTest() {
    const runtime = createCodemodeRuntime({
      ctx: this.ctx,
      executor: new DynamicWorkerExecutor({ loader: this.env.LOADER, timeout: 60_000 }),
      connectors: [new DabstepConnector(this.ctx, this.env)]
    });
    return selfTest(runtime, { ai: this.env.AI, index: this.env.EXAMPLES });
  }

  #inflight?: Promise<SolveResult>;

  /**
   * Idempotent per agent: if the caller's connection drops and it calls again,
   * it joins the run already in progress (or gets the stored result) instead
   * of starting over.
   */
  async solve(req: SolveRequest): Promise<SolveResult> {
    const done = await this.ctx.storage.get<SolveResult>("result");
    if (done) return done;
    this.#inflight ??= this.#solve(req)
      .then(async (result) => {
        await this.ctx.storage.put("result", result);
        return result;
      })
      .finally(() => {
        this.#inflight = undefined;
      });
    return this.#inflight;
  }

  async #solve(req: SolveRequest): Promise<SolveResult> {
    const started = Date.now();
    const { task, arm, model, run } = req;
    const maxSteps = req.maxSteps ?? 20;

    const connectors: CodemodeConnector[] = [new DabstepConnector(this.ctx, this.env)];
    let history: GitHistoryConnector | undefined;
    let sink: ArtifactsSink | undefined;
    let examples: Example[] = [];
    const repoName = agentRepo(run, agentKey(req), arm);
    if (arm !== "baseline") {
      sink = new ArtifactsSink({ artifacts: this.env.ARTIFACTS, repo: repoName });
      history = new GitHistoryConnector(this.ctx, this.env, {
        sink,
        describe: () => `t${task.task_id}: ${task.question}`.slice(0, 200),
        extraTrailers: (): Record<string, string> =>
          examples.length ? { [TRAILERS.examples]: examples.map((e) => `${e.repo}@${e.sha.slice(0, 12)}`).join(", ") } : {}
      });
      connectors.push(history);
    }
    const runtime = createCodemodeRuntime({
      ctx: this.ctx,
      executor: new DynamicWorkerExecutor({ loader: this.env.LOADER, timeout: 60_000 }),
      connectors
    });
    history?.bind(runtime);

    // codemode-git-examples: the closest answer-producing runs of other tasks in this run.
    if (arm === "codemode-git-examples") {
      examples = await retrieveExamples({
        ai: this.env.AI,
        index: this.env.EXAMPLES,
        scope: run,
        question: task.question,
        excludeTask: task.task_id
      });
    }

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(examples) },
      { role: "user", content: `Question: ${task.question}\n\nAnswer guidelines: ${task.guidelines}` }
    ];
    const result: SolveResult = {
      task_id: task.task_id,
      repeat: req.repeat ?? 0,
      exhausted: false,
      arm,
      model,
      answer: "",
      steps: 0,
      executions: 0,
      errors: 0,
      tokens: { input: 0, output: 0 },
      examplesOffered: examples.map((e) => `${e.repo}@${e.sha.slice(0, 12)}`),
      ms: 0,
      transcript: []
    };

    // The execution whose result the final answer was based on: the last one that completed.
    let lastCompleted: string | undefined;
    // One chance to fix a malformed final answer.
    let reformatAsked = false;

    /** Reply to a tool call if there was one, else as a user turn. */
    const reply = (callId: string | undefined, content: string) =>
      messages.push(callId ? { role: "tool", tool_call_id: callId, content } : { role: "user", content });

    for (let step = 0; step < maxSteps && !result.answer; step++) {
      result.steps++;
      if (step === maxSteps - 2) {
        messages.push({ role: "user", content: "You are almost out of steps. Call final_answer with your best answer now." });
      }
      const turn = await chat(this.env.AI, model, messages);
      result.tokens.input += turn.input;
      result.tokens.output += turn.output;
      // Echo tool calls back with valid JSON arguments: the API rejects the
      // whole conversation if a model emitted malformed arguments earlier.
      const toolCalls = turn.toolCalls.map((c) => ({
        ...c,
        function: { ...c.function, arguments: JSON.stringify(parseArgs(c.function.arguments)) }
      }));
      messages.push({ role: "assistant", content: turn.text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });

      const actions = actionsFrom(turn.text, turn.toolCalls);
      // Every tool call needs a tool reply; tell the model about ones we couldn't use.
      const answered = new Set(actions.map((a) => a.callId).filter(Boolean));
      for (const c of toolCalls) {
        if (!answered.has(c.id)) {
          reply(c.id, 'Invalid arguments. Call codemode with {"code": "<async arrow function>"} or final_answer with {"answer": "..."}.');
        }
      }
      if (!actions.length) {
        if (!toolCalls.length) {
          messages.push({ role: "user", content: "Call the codemode tool to run code, or final_answer when you are confident." });
        }
        continue;
      }
      for (const action of actions) {
        if (action.kind === "answer") {
          if (result.executions === 0) {
            reply(action.callId, "Check against the data with code before giving a final answer.");
            continue;
          }
          if (malformedAnswer(action.answer) && !reformatAsked) {
            reformatAsked = true;
            reply(action.callId, "Not recorded: submit only the answer value in the format the guidelines require, on one line, with no explanation or markdown.");
            continue;
          }
          result.answer = action.answer;
          reply(action.callId, "Recorded.");
          continue;
        }
        result.executions++;
        const outcome = await runtime.execute({ code: action.code });
        if (outcome.status === "completed") {
          lastCompleted = outcome.executionId;
          const logs = outcome.logs?.length ? `\nLogs:\n${clip(outcome.logs.join("\n"))}` : "";
          reply(action.callId, `Result:\n${clip(outcome.result)}${logs}`);
        } else {
          result.errors++;
          reply(action.callId, `Error:\n${clip("error" in outcome ? outcome.error : outcome.status)}`);
        }
      }
    }

    if (!result.answer) {
      result.exhausted = true;
      result.answer = "Not Applicable";
    }
    // Make sure every run is pushed before reporting, then mark which run the
    // answer came from.
    await history?.flush();
    const finalSha = lastCompleted && history?.commits(200).find((c) => c.execution_id === lastCompleted && c.sha)?.sha;
    if (sink && finalSha && result.answer !== "Not Applicable") {
      await sink.commit(
        toFinalCommit(finalSha, `Answer t${task.task_id}: ${result.answer}`.slice(0, 200), {
          "answer.json": `${JSON.stringify({ task_id: task.task_id, question: task.question, answer: result.answer, run: finalSha }, null, 2)}\n`
        })
      );
      // The answer-producing run becomes an example for later agents in this run.
      if (arm === "codemode-git-examples") {
        const code = (await runtime.executions()).find((e) => e.id === lastCompleted)?.code;
        if (code) {
          await indexExample({
            ai: this.env.AI,
            index: this.env.EXAMPLES,
            scope: run,
            task: task.task_id,
            repo: repoName,
            sha: finalSha,
            question: task.question,
            code,
            ok: !result.exhausted
          });
        }
      }
    }
    result.ms = Date.now() - started;
    result.transcript = messages.slice(1).map((m) => ({
      role: m.role,
      content: (m.role === "assistant" && m.tool_calls ? `${m.content}\n[tool calls] ${JSON.stringify(m.tool_calls)}` : m.content).slice(0, 3000)
    }));
    return result;
  }
}
