import { runAi } from "./ai";
// Turns a cluster of similar runs (from different agents) into one
// parameterized snippet. Voyager-style: propose, verify by replay, and on
// failure try once more with the verifier's feedback.

export const CODE_MODEL = "@cf/moonshotai/kimi-k2.7-code";

export type SourceRun = {
  repo: string;
  sha: string;
  intent: string;
  code: string;
  calls: { connector: string; method: string; args: unknown }[];
  result: unknown;
};

export type Proposal = {
  name: string;
  description: string;
  inputSchema: unknown;
  code: string;
  /** One input per source run, in the same order, that should reproduce its result. */
  inputs: unknown[];
};

const SYSTEM = `You maintain a shared library of reusable Code Mode skills.

You will see several scripts written independently by different agents that do the same kind of task with different literal values. Write ONE skill that generalizes them.

The skill is a JavaScript async arrow function that takes a single \`input\` object:
  async (input) => { ... }

Rules:
- Call only the connector globals and methods the source scripts call, with the same argument shapes.
- Turn the literal values that differ between scripts (categories, ids, thresholds, queries...) into fields of \`input\`.
- Keep it deterministic. No fetch, no Date.now(), no Math.random(), no \`codemode.*\`.
- Await connector calls one at a time, in the same order the source scripts make them.
- For each source script, the skill called with that script's input must make the same connector calls and return exactly the same value.
- name: short kebab-case verb phrase (e.g. "count-in-stock-by-category").
- description: one sentence saying what it does and what input it takes.

Reply with JSON only, no prose and no code fences:
{"name": string, "description": string, "inputSchema": <JSON Schema object>, "code": string, "inputs": [<input for source 1>, <input for source 2>, ...]}`;

function describeRuns(runs: SourceRun[]): string {
  return runs
    .map((run, i) => {
      const calls = run.calls
        .slice(0, 8)
        .map((c) => `  ${c.connector}.${c.method}(${JSON.stringify(c.args)})`)
        .join("\n");
      return [
        `### Source ${i + 1} (agent ${run.repo}): ${run.intent}`,
        "```js",
        run.code.trim(),
        "```",
        `Calls made:\n${calls}${run.calls.length > 8 ? `\n  ... ${run.calls.length - 8} more` : ""}`,
        `Returned: ${JSON.stringify(run.result).slice(0, 400)}`
      ].join("\n");
    })
    .join("\n\n");
}

function parseProposal(text: string, sources: number): Proposal {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const p = JSON.parse(json) as Proposal;
  if (!p.name || !p.code || !Array.isArray(p.inputs)) throw new Error("proposal is missing name, code or inputs");
  if (p.inputs.length !== sources) throw new Error(`expected ${sources} inputs, got ${p.inputs.length}`);
  p.name = p.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return p;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function chat(ai: Ai, messages: ChatMessage[]): Promise<string> {
  const out = (await runAi(ai, CODE_MODEL, {
    messages,
    // A reasoning model spends much of this before it writes the answer.
    max_completion_tokens: 16000
  })) as { choices?: { message?: { content?: string | null; reasoning_content?: string } }[]; response?: string };
  const message = out.choices?.[0]?.message;
  // Fall back to the reasoning text: the JSON is sometimes only there.
  const text = message?.content || out.response || message?.reasoning_content;
  if (!text) throw new Error("empty response from model");
  return text;
}

export class Generalizer {
  #messages: ChatMessage[];

  constructor(
    private ai: Ai,
    private runs: SourceRun[]
  ) {
    this.#messages = [
      { role: "system", content: SYSTEM },
      { role: "user", content: describeRuns(runs) }
    ];
  }

  async propose(): Promise<Proposal> {
    const text = await chat(this.ai, this.#messages);
    this.#messages.push({ role: "assistant", content: text });
    return parseProposal(text, this.runs.length);
  }

  /** Feed back what failed and ask for a corrected skill. */
  async repair(failures: string[]): Promise<Proposal> {
    this.#messages.push({
      role: "user",
      content: `Replaying your skill against the source runs failed:\n${failures.map((f) => `- ${f}`).join("\n")}\n\nFix it. Reply with the full JSON again.`
    });
    return this.propose();
  }
}
