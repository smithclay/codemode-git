import { DurableObject } from "cloudflare:workers";
import { createCodemodeRuntime, DynamicWorkerExecutor, type CodemodeConnector } from "@cloudflare/codemode";
import { ArtifactsSink, GitHistoryConnector, syncSkills, TRAILERS } from "codemode-git";
import { runAi } from "codemode-git-curator/ai";
import { DabstepConnector, SCHEMA } from "./connector";

export type Env = {
  DB: D1Database;
  ARTIFACTS: Artifacts;
  AI: Ai;
  LOADER: WorkerLoader;
};

/** baseline: stock Code Mode. codemode-git: + per-agent git history + curated skills. */
export type Arm = "baseline" | "codemode-git";

export type Task = { task_id: string; question: string; guidelines: string; level: string };

export type SolveRequest = { run: string; arm: Arm; task: Task; model: string; maxSteps?: number };

export type SolveResult = {
  task_id: string;
  arm: Arm;
  model: string;
  answer: string;
  steps: number;
  executions: number;
  errors: number;
  tokens: { input: number; output: number };
  skillsOffered: string[];
  skillsUsed: string[];
  skillsRef: string | null;
  ms: number;
  /** Assistant/user turns after the system prompt, clipped. For debugging failures. */
  transcript: { role: string; content: string }[];
};

export const agentRepo = (run: string, taskId: string) => `${run}-codemode-git-t${taskId}`;
export const skillsRepo = (run: string) => `${run}-skills`;

// The manual is ~22k chars; agents must be able to read it whole.
const MAX_FEEDBACK_CHARS = 24_000;

function systemPrompt(skills: { name: string; description: string }[]): string {
  return `You are a data analyst agent. You answer a question about a payments dataset by writing JavaScript that runs in a sandbox.

## How to work
Call the \`codemode\` tool with an async arrow function, e.g.
async () => { const { rows } = await data.sql({ query: "SELECT COUNT(*) AS n FROM payments" }); return rows; }
You get back its return value or error. Repeat as needed. When you are confident, call \`final_answer\`.

## Sandbox
The only globals are \`data\`, \`codemode\` and standard JavaScript. No fetch, no imports, no Node APIs.
- \`await data.sql({ query, params })\` runs one read-only SQLite query and returns \`{ rows }\` (max 5000 rows — aggregate in SQL).
- \`await data.doc({ name })\` returns "manual.md" or "payments-readme.md" as text.
- \`await codemode.search(query)\` / \`await codemode.describe(path)\` discover methods and saved snippets.
- \`await codemode.run(name, input)\` runs a saved snippet.

${SCHEMA}

## Rules
- Read the manual before answering fee, fraud or volume questions; its definitions are authoritative.
- Prefer computing in SQL. Return compact values from code, not raw tables.
- Follow the answer guidelines exactly (format, rounding, units). If the question has no applicable answer, answer "Not Applicable".
${
  skills.length
    ? `\n## Shared skills\nOther agents' verified code, available via codemode.run(name, input). Use one if it fits; check its input with codemode.describe(name).\n${skills
        .map((s) => `- ${s.name}: ${s.description}`)
        .join("\n")}\n`
    : ""
}`;
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
      description: "Submit the final answer, formatted exactly as the answer guidelines require.",
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

function parseArgs(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/** What the model wants to do: from tool calls, or from text if it didn't use them. */
function actionsFrom(text: string, toolCalls: ToolCall[]): Action[] {
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

function clip(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_FEEDBACK_CHARS ? `${text.slice(0, MAX_FEEDBACK_CHARS)}… (truncated, ${text.length} chars)` : text;
}

/** One agent, one task. */
export class Solver extends DurableObject<Env> {
  async solve(req: SolveRequest): Promise<SolveResult> {
    const started = Date.now();
    const { task, arm, model, run } = req;
    const maxSteps = req.maxSteps ?? 20;

    const connectors: CodemodeConnector[] = [new DabstepConnector(this.ctx, this.env)];
    let history: GitHistoryConnector | undefined;
    let skillsRef: string | null = null;
    if (arm === "codemode-git") {
      history = new GitHistoryConnector(this.ctx, this.env, {
        sink: new ArtifactsSink({ artifacts: this.env.ARTIFACTS, repo: agentRepo(run, task.task_id) }),
        describe: () => `t${task.task_id}: ${task.question}`.slice(0, 200),
        extraTrailers: (): Record<string, string> => (skillsRef ? { [TRAILERS.skillsRef]: skillsRef } : {})
      });
      connectors.push(history);
    }
    const runtime = createCodemodeRuntime({
      ctx: this.ctx,
      executor: new DynamicWorkerExecutor({ loader: this.env.LOADER, timeout: 60_000 }),
      connectors
    });
    history?.bind(runtime);

    // codemode-git: pull the run's skill library, offer the best matches (Voyager-style retrieval).
    let offered: { name: string; description: string }[] = [];
    if (arm === "codemode-git") {
      const synced = await syncSkills({
        ctx: this.ctx,
        artifacts: this.env.ARTIFACTS,
        repo: skillsRepo(run),
        connectors: ["data"]
      });
      skillsRef = synced.sha;
      if (synced.installed.length) {
        const snippets = await runtime.snippets();
        const ranked = (await runtime.search(task.question)).results
          .filter((r) => r.kind === "snippet")
          .map((r) => r.path);
        const order = [...ranked, ...snippets.map((s) => s.name).filter((n) => !ranked.includes(n))];
        offered = order
          .slice(0, 5)
          .map((name) => snippets.find((s) => s.name === name)!)
          .filter(Boolean)
          .map((s) => ({ name: s.name, description: s.description }));
      }
    }

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(offered) },
      { role: "user", content: `Question: ${task.question}\n\nAnswer guidelines: ${task.guidelines}` }
    ];
    const result: SolveResult = {
      task_id: task.task_id,
      arm,
      model,
      answer: "",
      steps: 0,
      executions: 0,
      errors: 0,
      tokens: { input: 0, output: 0 },
      skillsOffered: offered.map((s) => s.name),
      skillsUsed: [],
      skillsRef,
      ms: 0,
      transcript: []
    };

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
      messages.push({ role: "assistant", content: turn.text, ...(turn.toolCalls.length ? { tool_calls: turn.toolCalls } : {}) });

      const actions = actionsFrom(turn.text, turn.toolCalls);
      if (!actions.length) {
        messages.push({ role: "user", content: "Call the codemode tool to run code, or final_answer when you are confident." });
        continue;
      }
      for (const action of actions) {
        if (action.kind === "answer") {
          if (result.executions === 0) {
            reply(action.callId, "Check against the data with code before giving a final answer.");
            continue;
          }
          result.answer = action.answer;
          reply(action.callId, "Recorded.");
          continue;
        }
        result.executions++;
        for (const m of action.code.matchAll(/codemode\.run\(\s*["'`]([^"'`]+)/g)) {
          if (!result.skillsUsed.includes(m[1]!)) result.skillsUsed.push(m[1]!);
        }
        const outcome = await runtime.execute({ code: action.code });
        if (outcome.status === "completed") {
          const logs = outcome.logs?.length ? `\nLogs:\n${clip(outcome.logs.join("\n"))}` : "";
          reply(action.callId, `Result:\n${clip(outcome.result)}${logs}`);
        } else {
          result.errors++;
          reply(action.callId, `Error:\n${clip("error" in outcome ? outcome.error : outcome.status)}`);
        }
      }
    }

    if (!result.answer) result.answer = "Not Applicable";
    // Make sure every run is pushed before reporting, so the curator sees it.
    await history?.flush();
    result.ms = Date.now() - started;
    result.transcript = messages.slice(1).map((m) => ({
      role: m.role,
      content: (m.role === "assistant" && m.tool_calls ? `${m.content}\n[tool calls] ${JSON.stringify(m.tool_calls)}` : m.content).slice(0, 3000)
    }));
    return result;
  }
}
