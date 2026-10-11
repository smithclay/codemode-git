#!/usr/bin/env node
// Run DABstep tasks through one arm of the benchmark worker.
//
//   node scripts/run.mjs --run dev1 --arm codemode-git --model @cf/moonshotai/kimi-k2.7-code \
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values: opts } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:8790" },
    run: { type: "string" },
    arm: { type: "string" },
    model: { type: "string", default: "@cf/moonshotai/kimi-k2.7-code" },
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
  .map(({ task_id, question, guidelines, level }) => ({ task_id: String(task_id), question, guidelines, level }));
if (opts.tasks) {
  const wanted = new Set(opts.tasks.split(","));
  tasks = tasks.filter((t) => wanted.has(t.task_id));
}
if (opts.limit) tasks = tasks.slice(0, Number(opts.limit));

mkdirSync(join(root, "results"), { recursive: true });
const out = join(root, "results", `${opts.run}-${opts.arm}.jsonl`);
const done = new Set(
  existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).task_id) : []
);
tasks = tasks.filter((t) => !done.has(t.task_id));

async function solve(task) {
  const res = await fetch(`${opts.url}/solve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run: opts.run, arm: opts.arm, model: opts.model, task, maxSteps: Number(opts["max-steps"]) })
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const size = Number(opts.concurrency);
console.log(`${opts.run}/${opts.arm}: ${tasks.length} tasks, waves of ${size}, model ${opts.model}`);
for (let i = 0; i < tasks.length; i += size) {
  const wave = tasks.slice(i, i + size);
  const results = await Promise.all(
    wave.map(async (task) => {
      try {
        return await solve(task);
      } catch (err) {
        console.error(`  t${task.task_id} failed: ${err.message}`);
        return null;
      }
    })
  );
  for (const r of results.filter(Boolean)) {
    appendFileSync(out, `${JSON.stringify({ ...r, level: wave.find((t) => t.task_id === r.task_id)?.level })}\n`);
    console.log(
      `  t${r.task_id}: ${JSON.stringify(r.answer).slice(0, 50)} · ${r.executions} runs, ${r.errors} errors, ` +
        `${r.tokens.input + r.tokens.output} tok${r.skillsUsed.length ? ` · skills ${r.skillsUsed.join(",")}` : ""}`
    );
  }
  if (opts.arm === "codemode-git") {
    const res = await fetch(`${opts.url}/curate/${opts.run}/backfill`, { method: "POST" });
    const c = res.ok ? await res.json() : { error: await res.text() };
    console.log(`  curator: ${JSON.stringify(c)}`);
  }
}
console.log(`wrote ${out}`);
