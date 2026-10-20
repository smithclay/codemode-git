import type { CodemodeRuntimeHandle } from "@cloudflare/codemode";
import { CODE_LINE, CODE_SIZE, H, KICKER, MARGIN, MAX_WORDS, TEXT_SIZE, W } from "../spec";

// The deck agent: a Workers AI tool-calling loop around the Code Mode runtime,
// adapted from examples/agent/src/ask.ts. Each turn the model works on the
// deck by running code against `slides.*`, then answers with `reply`.

export const MODEL = "@cf/zai-org/glm-5.3-flash";
const MAX_FEEDBACK_CHARS = 8_000;

export type Effort = "low" | "high";
export type Turn = { role: "user" | "assistant"; content: string };
export type TurnResult = {
  reply: string;
  steps: number;
  executions: number;
  errors: number;
  tokens: { input: number; output: number };
  executionIds: string[];
};

const SYSTEM = `You are the deck agent for a talk about codemode-git ("Self-Improving Code Mode Workers, with Artifacts Memory"). The deck is a git repo of slide programs. You change it by writing JavaScript that runs in a sandbox, then you tell the presenter what you did.

## How to work
Call the \`codemode\` tool with an async arrow function; its return value (or error) comes back to you. Read before you edit. When you build a slide from its outline prompt, follow the prompt closely: everything it names belongs on the slide, and nothing it doesn't. When the request is done, call \`reply\` with one or two plain sentences for the presenter.

## Sandbox (no fetch, no imports)
- \`await slides.outline()\`: every planned slide: { id, prompt, notes }. The prompt says what the slide should show; the notes are what the speaker says over it (never put the notes on the slide).
- \`await slides.list()\`: slides in order: { id, built, sha, kicker }.
- \`await slides.read({ id })\`: { id, code, slide } or null.
- \`await slides.write({ id, code, message? })\`: runs the program in a fresh sandbox, checks the layout, and commits it. Returns { ok: true, sha } or { ok: false, problems } (nothing saved). Fix the problems and write again.
- \`await slides.remove({ id })\`: delete a slide (git history keeps it).
- \`await slides.order({ ids })\`: set the presentation order. A new slide (a write with a new id) joins the end; reorder to put it in place.
- \`await slides.data({ name })\`: the benchmark data: "accuracy", "learningCurve" or "walkthrough".

## Slide programs
A slide is a self-contained async arrow function returning { kicker?, elements }. Inside it only \`deck.data(name)\` (same data as slides.data) and \`deck.check(slide)\` exist; it cannot see your variables. Write it as a real function and pass its source:
  const hook = async () => { const acc = await deck.data("accuracy"); return { kicker: "…", elements: [ … ] }; };
  return await slides.write({ id: "hook", code: hook.toString() });
To change a slide, read its code and either edit the string (code.replace(...)) or write a new function.

## Slide spec
Canvas ${W}×${H} px, dark background. Keep everything inside ${MARGIN}–${W - MARGIN} × ${MARGIN}–${H - MARGIN}. kicker: a short ALL-CAPS label drawn top-left in orange, at x ${KICKER.x}, y ${KICKER.y - 20}–${KICKER.y + 20}; start other elements below y ${KICKER.y + 50}.
Elements:
- { type: "text", x, y, text, size?=${TEXT_SIZE}, color?, align?: "start"|"middle"|"end" (default "middle"), bold?, mono? }  // (x, y) is the anchor; y is the vertical middle
- { type: "box", x, y, w, h, label?, sub?, color?, dashed? }  // rounded panel; label centered, sub in small mono under it
- { type: "arrow", x1, y1, x2, y2, color?, dashed? }
- { type: "agent", x, y, r?=46, color?, label? }  // a robot in a ring; ring color is its state
- { type: "bars" | "line", x, y, w, h, categories: string[], series: [{ label, values: number[], color? }], unit? }
- { type: "code", x, y, w, lines: string[], title? }  // terminal/code panel: ${CODE_SIZE}px mono, ${CODE_LINE}px per line
Colors are tokens: "text" (default), "muted", "orange" (the accent), "amber" (highlights), "green" (right), "red" (wrong).

## Style
One idea per slide, told with a diagram or a big number. At most ${MAX_WORDS} words on a slide. Big type (headlines 80–190px, labels 28–40px), lots of empty space, orange and amber only for what matters. Charts use deck.data, never invented numbers. Compute layouts in code (loops, helpers) instead of guessing coordinates.`;

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
      name: "reply",
      description: "Finish this request: one or two plain sentences for the presenter about what changed.",
      parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] }
    }
  }
];

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Workers AI with a few retries on rate limits and transient errors. */
async function runAi(ai: Ai, input: unknown): Promise<unknown> {
  for (let i = 0; ; i++) {
    try {
      return await (ai.run as (m: string, i: unknown) => Promise<unknown>)(MODEL, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (i >= 3 || !/3021|3040|rate limit|capacity|timeout|network connection lost/i.test(message)) throw err;
      await new Promise((r) => setTimeout(r, 2_000 * 2 ** i));
    }
  }
}

async function chat(ai: Ai, messages: ChatMessage[], effort: Effort) {
  const out = (await runAi(ai, { messages, tools: TOOLS, max_completion_tokens: 12000, reasoning_effort: effort })) as {
    choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
    response?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = out.choices?.[0]?.message;
  return {
    text: message?.content ?? out.response ?? "",
    toolCalls: message?.tool_calls ?? [],
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

const clip = (value: unknown) => {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.length > MAX_FEEDBACK_CHARS ? `${text.slice(0, MAX_FEEDBACK_CHARS)}… (truncated)` : text;
};

const context = (current?: { id: string; prompt?: string }) =>
  current ? `(The presenter is on slide "${current.id}".${current.prompt ? ` Its outline prompt: ${current.prompt}` : ""})\n` : "";

/** One request from the presenter, worked on until the model replies or runs out of steps. */
export async function runTurn(opts: {
  ai: Ai;
  runtime: CodemodeRuntimeHandle;
  history: Turn[];
  message: string;
  /** The slide the presenter is looking at, so "this slide" means something, and its outline prompt. */
  current?: { id: string; prompt?: string };
  /**
   * "low" for chat edits: high effort reasons for thousands of tokens a step,
   * which makes a turn take minutes. "high" for building a slide from scratch,
   * where low effort cuts corners.
   */
  effort?: Effort;
  maxSteps?: number;
}): Promise<TurnResult> {
  const maxSteps = opts.maxSteps ?? 12;
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    ...opts.history,
    { role: "user", content: `${context(opts.current)}${opts.message}` }
  ];
  const result: TurnResult = { reply: "", steps: 0, executions: 0, errors: 0, tokens: { input: 0, output: 0 }, executionIds: [] };
  const answer = (callId: string | undefined, content: string) =>
    messages.push(callId ? { role: "tool", tool_call_id: callId, content } : { role: "user", content });

  for (let step = 0; step < maxSteps && !result.reply; step++) {
    result.steps++;
    if (step === maxSteps - 2) messages.push({ role: "user", content: "You are almost out of steps. Finish what you can and call reply." });
    const turn = await chat(opts.ai, messages, opts.effort ?? "low");
    result.tokens.input += turn.input;
    result.tokens.output += turn.output;
    // Echo tool calls back with valid JSON arguments: the API rejects the
    // whole conversation if a model emitted malformed arguments earlier.
    const toolCalls = turn.toolCalls.map((c) => ({ ...c, function: { ...c.function, arguments: JSON.stringify(parseArgs(c.function.arguments)) } }));
    messages.push({ role: "assistant", content: turn.text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });

    if (!toolCalls.length) {
      // A plain-text answer is a reply, once some code has run.
      if (turn.text.trim() && result.executions) result.reply = turn.text.trim();
      else answer(undefined, "Call codemode to work on the deck, or reply when you are done.");
      continue;
    }
    for (const call of toolCalls) {
      const args = parseArgs(call.function.arguments);
      if (call.function.name === "reply") {
        // Replying without running anything is how a model claims work it didn't do.
        if (!result.executions) {
          answer(call.id, "You haven't run any code yet. Do the work with codemode first, then reply.");
          continue;
        }
        result.reply = (args.message ?? "").trim() || "Done.";
        answer(call.id, "Sent.");
        continue;
      }
      if (result.reply) {
        answer(call.id, "Already replied; not run.");
        continue;
      }
      if (!args.code) {
        answer(call.id, 'Invalid arguments. Call codemode with {"code": "<async arrow function>"}.');
        continue;
      }
      result.executions++;
      const outcome = await opts.runtime.execute({ code: args.code });
      result.executionIds.push(outcome.executionId);
      if (outcome.status === "completed") {
        const logs = outcome.logs?.length ? `\nLogs:\n${clip(outcome.logs.join("\n"))}` : "";
        answer(call.id, `Result:\n${clip(outcome.result)}${logs}`);
      } else {
        result.errors++;
        answer(call.id, `Error:\n${clip("error" in outcome ? outcome.error : outcome.status)}`);
      }
    }
  }
  if (!result.reply) result.reply = `I ran out of steps after ${result.executions} programs; check the slides and ask again.`;
  return result;
}
