#!/usr/bin/env node
// Concurrency burst: N independent agents each run one Code Mode execution
// and push it as a commit to their own Artifacts repo, all at once.
//
//   node scripts/swarm.mjs <base-url> [--agents 1000] [--concurrency 200] [--prefix swarm]
//
// Each agent is its own Durable Object with its own repo (agent-<prefix>-<run>-<i>).
// Nothing is shared on the write path, so there's nothing to lock or merge.
// Set ADMIN_TOKEN in the environment if the Worker requires it.

const [base, ...rest] = process.argv.slice(2);
if (!base) {
  console.error("usage: node scripts/swarm.mjs <base-url> [--agents N] [--concurrency C] [--prefix P]");
  process.exit(1);
}
const flag = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const agents = Number(flag("agents", 1000));
const concurrency = Number(flag("concurrency", 200));
const prefix = flag("prefix", "swarm");
const run = Date.now().toString(36);
const headers = process.env.ADMIN_TOKEN ? { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {};

const WAX = ["red", "orange", "yellow", "green", "blue", "purple", "pink"];
const code = (wax) => `// Count ${wax} lava lamps that are flowing, across every page of the wall
async () => {
  let cursor = null, count = 0;
  do {
    const page = await lamps.wall({ wax: "${wax}", cursor });
    count += page.lamps.filter((l) => l.status === "flowing").length;
    cursor = page.nextCursor;
  } while (cursor);
  return count;
}`;

async function post(path, body) {
  const res = await fetch(new URL(path, base), { method: "POST", headers, body });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function runAgent(i) {
  const name = `${prefix}-${run}-${i}`;
  const t0 = performance.now();
  const exec = await post(`/agents/${name}/execute`, code(WAX[i % WAX.length]));
  const t1 = performance.now();
  const commits = await post(`/agents/${name}/flush`);
  const t2 = performance.now();
  const latest = commits[0];
  if (!latest?.sha) throw new Error(`${name}: not pushed (${latest?.error ?? "no commit"})`);
  return { name, status: exec.status, sha: latest.sha, executeMs: t1 - t0, pushMs: t2 - t1, totalMs: t2 - t0 };
}

const results = [];
const errors = [];
let next = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: Math.min(concurrency, agents) }, async () => {
    while (next < agents) {
      const i = next++;
      try {
        results.push(await runAgent(i));
      } catch (err) {
        errors.push(String(err.message ?? err));
      }
      const done = results.length + errors.length;
      if (done % 50 === 0 || done === agents) {
        process.stderr.write(`\r${done}/${agents} done, ${errors.length} errors`);
      }
    }
  })
);
const wallMs = performance.now() - started;
process.stderr.write("\n");

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]) : null;
};
const summary = {
  run,
  agents,
  concurrency,
  reposWithCommit: results.length,
  errors: errors.length,
  wallSeconds: Math.round(wallMs / 100) / 10,
  commitsPerSecond: Math.round((results.length / (wallMs / 1000)) * 10) / 10,
  executeMs: { p50: pct(results.map((r) => r.executeMs), 50), p95: pct(results.map((r) => r.executeMs), 95) },
  pushMs: { p50: pct(results.map((r) => r.pushMs), 50), p95: pct(results.map((r) => r.pushMs), 95) },
  totalMs: { p50: pct(results.map((r) => r.totalMs), 50), p95: pct(results.map((r) => r.totalMs), 95) },
  sampleErrors: [...new Set(errors)].slice(0, 5),
  sampleRepo: results[0] && `agent-${results[0].name}@${results[0].sha.slice(0, 12)}`
};
console.log(JSON.stringify(summary, null, 2));
