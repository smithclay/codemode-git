// Layer 2, boring version: "git log as few-shot examples". When an agent
// finishes, it indexes its answer-producing run (question + code) in
// Vectorize. When an agent starts, it retrieves the closest runs other agents
// answered with and reads them as unverified examples. No curator, no model
// calls beyond one embedding per task. Every example is a commit (repo@sha).
//
// Embedding practice (Qwen3-Embedding): the task instruction goes on the query
// side only; documents are embedded raw. Code is indexed together with a
// natural-language description of what it does (here, the question it
// answered), which aligns natural-language queries with code far better than
// code alone.

export const EXAMPLE_EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
const QUERY_INSTRUCTION =
  "Given a data-analysis question, retrieve code that other agents wrote to answer similar questions";
const MAX_CODE_CHARS = 6000;

export type Example = {
  repo: string;
  sha: string;
  task: string;
  question: string;
  code: string;
  score: number;
};

type ExampleMetadata = {
  scope: string;
  task: string;
  ok: boolean;
  repo: string;
  sha: string;
  question: string;
  code: string;
};

async function embed(ai: Ai, text: string): Promise<number[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const out = (await (ai.run as (m: string, i: unknown) => Promise<unknown>)(EXAMPLE_EMBEDDING_MODEL, {
        documents: [text]
      })) as { data: number[][] };
      return out.data[0]!;
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

const documentText = (question: string, code: string) => `Question: ${question}\n\nCode:\n${code}`.slice(0, 8000);
const queryText = (question: string) => `Instruct: ${QUERY_INSTRUCTION}\nQuery: ${question}`;

/** Index one agent's answer-producing run. `ok: false` keeps it out of retrieval (e.g. it ran out of steps). */
export async function indexExample(opts: {
  ai: Ai;
  index: Vectorize;
  scope: string;
  task: string;
  repo: string;
  sha: string;
  question: string;
  code: string;
  ok: boolean;
}): Promise<void> {
  const code = opts.code.slice(0, MAX_CODE_CHARS);
  const metadata: ExampleMetadata = {
    scope: opts.scope,
    task: opts.task,
    ok: opts.ok,
    repo: opts.repo,
    sha: opts.sha,
    question: opts.question.slice(0, 500),
    code
  };
  await opts.index.upsert([
    { id: opts.sha, values: await embed(opts.ai, documentText(opts.question, code)), metadata }
  ]);
}

/** The k closest runs from other tasks in this scope, one per task. */
export async function retrieveExamples(opts: {
  ai: Ai;
  index: Vectorize;
  scope: string;
  question: string;
  excludeTask: string;
  k?: number;
}): Promise<Example[]> {
  const k = opts.k ?? 3;
  const { matches } = await opts.index.query(await embed(opts.ai, queryText(opts.question)), {
    topK: 20,
    returnMetadata: "all",
    filter: { scope: { $eq: opts.scope }, ok: { $eq: true } }
  });
  const seen = new Set<string>([opts.excludeTask]);
  const examples: Example[] = [];
  for (const match of matches) {
    const m = match.metadata as unknown as ExampleMetadata | undefined;
    if (!m || seen.has(m.task)) continue;
    seen.add(m.task);
    examples.push({ repo: m.repo, sha: m.sha, task: m.task, question: m.question, code: m.code, score: match.score });
    if (examples.length === k) break;
  }
  return examples;
}
