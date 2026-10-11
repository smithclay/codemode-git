#!/usr/bin/env node
// Run DABstep tasks through one arm of the benchmark worker.
//
//   node scripts/run.mjs --run dev1 --arm codemode-git --model @cf/zai-org/glm-5.3-flash \
//     --split dev --concurrency 5 [--tasks 5,49] [--limit 25] [--url http://localhost:8790]
//
// Tasks go out in waves of --concurrency fresh agents. In the codemode-git arm
// the run's curator ingests each finished wave before the next one starts, so
// later waves can reuse skills learned from earlier ones. Results are appended
// to results/<run>-<arm>.jsonl (resumable: finished task ids are skipped).
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
    "max-steps": { type: "string", default: "20" }
  }
});
if (!opts.run || !["baseline", "codemode-git"].includes(opts.arm)) {
  console.error("usage: --run <id> --arm baseline|codemode-git [--model] [--split dev|all] [--tasks a,b] [--limit n]");
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
    })
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

/** Infrastructure failures are retried with a fresh agent, so results aren't biased toward easy tasks. */
async function solve(task) {
  for (let attempt = 1; ; attempt++) {
    try {
      return { ...(await solveOnce(task, attempt)), attempt };
    } catch (err) {
      console.error(`  t${task.task_id}#${task.repeat} attempt ${attempt} failed: ${err.message}`);
      if (attempt >= MAX_ATTEMPTS) return null;
    }
  }
}

const size = Number(opts.concurrency);
console.log(`${opts.run}/${opts.arm}: ${tasks.length} tasks, waves of ${size}, model ${opts.model}`);
for (let i = 0; i < tasks.length; i += size) {
  const wave = tasks.slice(i, i + size);
  const results = await Promise.all(
    wave.map(async (task, j) => {
      // Stagger launches a little to smooth Workers AI rate limits.
      await new Promise((r) => setTimeout(r, j * 2000));
      return solve(task);
    })
  );
  for (const r of results.filter(Boolean)) {
    appendFileSync(out, `${JSON.stringify({ ...r, level: wave.find((t) => t.task_id === r.task_id)?.level })}\n`);
    console.log(
      `  t${r.task_id}#${r.repeat}: ${JSON.stringify(r.answer).slice(0, 50)} · ${r.executions} runs, ${r.errors} errors, ` +
        `${r.exhausted ? "EXHAUSTED, " : ""}` +
        `${r.tokens.input + r.tokens.output} tok${r.skillsUsed.length ? ` · skills ${r.skillsUsed.join(",")}` : ""}`
    );
  }
  if (opts.arm === "codemode-git") {
    const res = await fetch(`${opts.url}/curate/${opts.run}/backfill`, { method: "POST", headers: auth });
    const c = res.ok ? await res.json() : { error: await res.text() };
    console.log(`  curator: ${JSON.stringify(c)}`);
  }
}
console.log(`wrote ${out}`);
