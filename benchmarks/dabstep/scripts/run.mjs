#!/usr/bin/env node
// Run DABstep tasks through one arm of the benchmark worker.
//
//   node scripts/run.mjs --run dev1 --arm codemode-git-examples --model @cf/zai-org/glm-5.3-flash \
//     --split dev --concurrency 5 [--rolling] [--tasks 5,49] [--limit 25] [--url http://localhost:8790]
//
// Tasks go out in waves of --concurrency fresh agents (or, with --rolling, a
// new agent starts whenever one finishes). In the examples arm, each agent's
// answer-producing run becomes an example later agents can retrieve. Results
// are appended to results/<run>-<arm>.jsonl (resumable: finished task ids are
// skipped).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Agent, setGlobalDispatcher } from "undici";

// A hard task can run for many minutes before the worker responds; Node's
// default fetch gives up waiting for headers after 5.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values: opts } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:8790" },
    run: { type: "string" },
    arm: { type: "string" },
    model: { type: "string", default: "@cf/zai-org/glm-5.3-flash" },
    split: { type: "string", default: "dev" },
    tasks: { type: "string" },
    limit: { type: "string" },
    concurrency: { type: "string", default: "5" },
    "max-steps": { type: "string", default: "20" },
    // Examples arm: wait between waves so new examples become filterable in Vectorize (~1-2 min).
    settle: { type: "string", default: "120" },
    // Rolling concurrency instead of lockstep waves (used for the full run).
    rolling: { type: "boolean", default: false },
    // Spend guard: stop launching new tasks once finished tasks in this
    // invocation have used this many tokens (~$0.12 per million on glm-5.3-flash).
    "budget-tokens": { type: "string", default: "175000000" }
  }
});
if (!opts.run || !["baseline", "codemode-git-examples"].includes(opts.arm)) {
  console.error("usage: --run <id> --arm baseline|codemode-git-examples [--model] [--split dev|all] [--rolling] [--tasks a,b] [--limit n]");
  process.exit(1);
}

let tasks = readFileSync(join(root, "data/tasks", `${opts.split}.jsonl`), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .map(({ task_id, question, guidelines, level, repeat = 0 }) => ({
    task_id: String(task_id),
    question,
    guidelines,
    level,
    repeat
  }));
const keyOf = (t) => `${t.task_id}#${t.repeat ?? 0}`;
if (opts.tasks) {
  const wanted = new Set(opts.tasks.split(","));
  tasks = tasks.filter((t) => wanted.has(t.task_id));
}
if (opts.limit) tasks = tasks.slice(0, Number(opts.limit));

mkdirSync(join(root, "results"), { recursive: true });
const out = join(root, "results", `${opts.run}-${opts.arm}.jsonl`);
const done = new Set(
  existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => keyOf(JSON.parse(l))) : []
);
tasks = tasks.filter((t) => !done.has(keyOf(t)));
const MAX_ATTEMPTS = 3;

// Required by the deployed worker; ignored by local dev.
const auth = process.env.HARNESS_TOKEN ? { authorization: `Bearer ${process.env.HARNESS_TOKEN}` } : {};

async function solveOnce(task, attempt) {
  const { repeat, ...taskFields } = task;
  const res = await fetch(`${opts.url}/solve`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({
      run: opts.run,
      arm: opts.arm,
      model: opts.model,
      task: taskFields,
      repeat,
      attempt,
      maxSteps: Number(opts["max-steps"])
    }),
    // A connection the worker drops without closing would otherwise hang the
    // whole wave; treat it as a failed attempt and retry with a fresh agent.
    signal: AbortSignal.timeout(45 * 60 * 1000)
  });
  if (!res.ok) {
    const body = await res.text();
    let error = body.slice(0, 300);
    try {
      error = JSON.parse(body).error.split("\n")[0];
    } catch {}
    throw new Error(`${res.status} ${error}`);
  }
  return res.json();
}

// The connection dropped but the agent may still be running: call the same
// agent again, which joins its run (or returns its stored result).
const RECONNECTABLE = /fetch failed|network connection lost|connection closed|socket|ECONNRESET/i;
const MAX_RECONNECTS = 6;

/** Infrastructure failures are retried with a fresh agent, so results aren't biased toward easy tasks. */
async function solve(task) {
  for (let attempt = 1; ; attempt++) {
    for (let reconnect = 0; ; reconnect++) {
      try {
        return { ...(await solveOnce(task, attempt)), attempt };
      } catch (err) {
        const cause = err.cause ? ` (${err.cause.code ?? err.cause.message ?? err.cause})` : "";
        const again = RECONNECTABLE.test(err.message) && reconnect < MAX_RECONNECTS;
        console.error(`  t${task.task_id}#${task.repeat} attempt ${attempt} failed: ${err.message}${cause}${again ? "; reconnecting" : ""}`);
        if (!again) break;
        await new Promise((r) => setTimeout(r, Number(process.env.RECONNECT_MS ?? 10_000)));
      }
    }
    if (attempt >= MAX_ATTEMPTS) return null;
  }
}

const size = Number(opts.concurrency);
const byKey = new Map(tasks.map((t) => [keyOf(t), t]));

let tokensUsed = 0;
const budget = Number(opts["budget-tokens"]);
const overBudget = () => tokensUsed >= budget;

function record(r) {
  tokensUsed += r.tokens.input + r.tokens.output;
  appendFileSync(out, `${JSON.stringify({ ...r, level: byKey.get(keyOf(r))?.level })}\n`);
  console.log(
    `  t${r.task_id}#${r.repeat}: ${JSON.stringify(r.answer).slice(0, 50)} · ${r.executions} runs, ${r.errors} errors, ` +
      `${r.exhausted ? "EXHAUSTED, " : ""}` +
      `${r.tokens.input + r.tokens.output} tok` +
      `${r.examplesOffered?.length ? ` · ${r.examplesOffered.length} examples` : ""}`
  );
}

if (opts.rolling) {
  // Keep `size` agents busy: a new task starts as soon as any finishes, so one
  // slow task never idles the other slots. Results are written as they land.
  // Examples become retrievable as soon as Vectorize indexes them (no settle).
  console.log(`${opts.run}/${opts.arm}: ${tasks.length} tasks, rolling concurrency ${size}, model ${opts.model}`);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, tasks.length) }, async (_, slot) => {
      // Stagger the first launches a little to smooth Workers AI rate limits.
      await new Promise((r) => setTimeout(r, slot * 2000));
      while (next < tasks.length && !overBudget()) {
        const r = await solve(tasks[next++]);
        if (r) record(r);
      }
    })
  );
} else {
  console.log(`${opts.run}/${opts.arm}: ${tasks.length} tasks, waves of ${size}, model ${opts.model}`);
  for (let i = 0; i < tasks.length && !overBudget(); i += size) {
    const wave = tasks.slice(i, i + size);
    const results = await Promise.all(
      wave.map(async (task, j) => {
        // Stagger launches a little to smooth Workers AI rate limits.
        await new Promise((r) => setTimeout(r, j * 2000));
        return solve(task);
      })
    );
    results.filter(Boolean).forEach(record);
    if (opts.arm === "codemode-git-examples" && i + size < tasks.length) {
      console.log(`  waiting ${opts.settle}s for examples to become searchable`);
      await new Promise((r) => setTimeout(r, Number(opts.settle) * 1000));
    }
  }
}
if (overBudget()) console.log(`STOPPED: token budget reached (${tokensUsed.toLocaleString()} of ${budget.toLocaleString()}); rerun to resume`);
console.log(`wrote ${out}`);
