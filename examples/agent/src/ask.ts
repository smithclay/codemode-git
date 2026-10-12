import type { CodemodeRuntimeHandle } from "@cloudflare/codemode";
import type { Example } from "@smithclay/codemode-git";

// A small Workers AI tool-calling loop around the Code Mode runtime: the model
// writes code (`codemode` tool), reads the result, and ends with `final_answer`.
// Trimmed from benchmarks/dabstep/src/solver.ts.

export const MODEL = "@cf/zai-org/glm-5.3-flash";
const MAX_FEEDBACK_CHARS = 8_000;

export type LoopResult = {
  answer: string;
  steps: number;
  executions: number;
  errors: number;
  tokens: { input: number; output: number };
  /** Every execution this loop started, oldest first. */
  executionIds: string[];
  /** The last execution that completed: the run the answer is based on. */
  answerExecutionId?: string;
};

export const exampleRef = (e: Example) => `${e.repo}@${e.sha.slice(0, 12)}`;

function examplesText(examples: Example[]): string {
  if (!examples.length) return "";
  return `
## How other agents approached similar questions
Unverified code other agents ran to answer related questions. It may be wrong or answer a slightly different question: adapt it, run it, and check the result yourself.
${examples.map((e) => `### ${e.question} (${exampleRef(e)})\n\`\`\`js\n${e.code.trim()}\n\`\`\``).join("\n\n")}
`;
}

function systemPrompt(examples: Example[]): string {
  return `You are an agent that answers questions about a wall of lava lamps by writing JavaScript that runs in a sandbox.

## How to work
Call the \`codemode\` tool with an async arrow function, e.g.
async () => { const page = await lamps.wall({}); return page.lamps.length; }
You get back its return value or error. Repeat as needed. When you are confident, call \`final_answer\`.

## Sandbox
Standard JavaScript plus these globals (no fetch, no imports):
- \`await lamps.wall({ row?, wax?, status?, cursor? })\` returns \`{ lamps, nextCursor }\`. At most 12 lamps per page: follow \`nextCursor\` until it is null to see them all. Each lamp is \`{ id, row, col, wax, status, hoursOn }\`; wax is red, orange, yellow, green, blue, purple or pink; status is flowing, warming or off.
- \`await lamps.get({ id })\` returns one lamp or null.
- \`await history.log({})\` and \`await history.show({ ref })\` list and show your own earlier runs.

## Rules
- Answer from data you fetched with code, not from guesses.
- final_answer takes only the answer value (e.g. a number), no explanation.
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
      description: "Submit only the final answer value. No explanation or markdown.",
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

/** Workers AI with a few retries on rate limits and transient errors. */
async function runAi(ai: Ai, model: string, input: unknown): Promise<unknown> {
  for (let i = 0; ; i++) {
    try {
      return await (ai.run as (m: string, i: unknown) => Promise<unknown>)(model, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (i >= 4 || !/3021|3040|rate limit|capacity|timeout|network connection lost/i.test(message)) throw err;
      await new Promise((r) => setTimeout(r, 2_000 * 2 ** i));
    }
  }
}

async function chat(ai: Ai, model: string, messages: ChatMessage[]) {
  const out = (await runAi(ai, model, { messages, tools: TOOLS, max_completion_tokens: 4000 })) as {
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

function parseArgs(raw: unknown): Record<string, string> {
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
  const fenced = /```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/.exec(text);
  if (fenced) return [{ kind: "code", code: fenced[1]!.trim() }];
  const final = /FINAL ANSWER:\s*(.+)/i.exec(text);
  if (final) return [{ kind: "answer", answer: final[1]!.trim() }];
  return [];
}

function clip(value: unknown): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.length > MAX_FEEDBACK_CHARS ? `${text.slice(0, MAX_FEEDBACK_CHARS)}… (truncated, ${text.length} chars)` : text;
}

/** Ask the model a question; it answers by running code through `runtime`. */
export async function runLoop(opts: {
  ai: Ai;
  runtime: CodemodeRuntimeHandle;
  question: string;
  examples: Example[];
  model?: string;
  maxSteps?: number;
}): Promise<LoopResult> {
  const model = opts.model ?? MODEL;
  const maxSteps = opts.maxSteps ?? 10;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(opts.examples) },
    { role: "user", content: `Question: ${opts.question}` }
  ];
  const result: LoopResult = {
    answer: "",
    steps: 0,
    executions: 0,
    errors: 0,
    tokens: { input: 0, output: 0 },
    executionIds: []
  };
  /** Reply to a tool call if there was one, else as a user turn. */
  const reply = (callId: string | undefined, content: string) =>
    messages.push(callId ? { role: "tool", tool_call_id: callId, content } : { role: "user", content });

  for (let step = 0; step < maxSteps && !result.answer; step++) {
    result.steps++;
    if (step === maxSteps - 2) {
      messages.push({ role: "user", content: "You are almost out of steps. Call final_answer with your best answer now." });
    }
    const turn = await chat(opts.ai, model, messages);
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
    // Every tool call needs a tool reply.
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
        if (!result.answerExecutionId) {
          reply(action.callId, "Check against the data with code before giving a final answer.");
          continue;
        }
        result.answer = action.answer.trim();
        reply(action.callId, "Recorded.");
        continue;
      }
      result.executions++;
      const outcome = await opts.runtime.execute({ code: action.code });
      result.executionIds.push(outcome.executionId);
      if (outcome.status === "completed") {
        result.answerExecutionId = outcome.executionId;
        const logs = outcome.logs?.length ? `\nLogs:\n${clip(outcome.logs.join("\n"))}` : "";
        reply(action.callId, `Result:\n${clip(outcome.result)}${logs}`);
      } else {
        result.errors++;
        reply(action.callId, `Error:\n${clip("error" in outcome ? outcome.error : outcome.status)}`);
      }
    }
  }
  return result;
}
