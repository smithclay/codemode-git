#!/usr/bin/env node
// Two agents, one learning from the other.
//
//   node scripts/walkthrough.mjs <base-url> [--prefix demo] [--wait 180] [--poll 10]
//
// 1. michelle answers "How many lava lamps on the wall are flowing right now?"
//    by writing and running her own code. Her answer-producing run is indexed.
// 2. Wait until matthew's retrieval can see michelle's run. Vectorize metadata
//    filters lag new vectors by ~1–2 minutes. --wait caps the wait (seconds);
//    --poll is how often to check.
// 3. matthew answers "How many red lava lamps are flowing?", shown michelle's
//    run as an unverified example.
//
// Agent names get a run-unique prefix (<prefix>-<run>-michelle) so every
// rerun starts with fresh agents and repos. Set ADMIN_TOKEN in the environment
// if the Worker requires it.

const [base, ...rest] = process.argv.slice(2);
if (!base) {
  console.error("usage: node scripts/walkthrough.mjs <base-url> [--prefix demo] [--wait 180] [--poll 10]");
  process.exit(1);
}
const flag = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const prefix = flag("prefix", "demo");
const waitSeconds = Number(flag("wait", 180));
const pollSeconds = Number(flag("poll", 10));
const run = Date.now().toString(36);
const auth = process.env.ADMIN_TOKEN ? { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {};

const AGENTS = [
  { label: "michelle", question: "How many lava lamps on the wall are flowing right now?", expected: "67" },
  { label: "matthew", question: "How many red lava lamps are flowing?", expected: "10" }
];
const agentName = (label) => `${prefix}-${run}-${label}`;

async function request(method, path, body) {
  const res = await fetch(new URL(path, base), {
    method,
    headers: body ? { ...auth, "content-type": "application/json" } : auth,
    body: body && JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function ask({ label, question }) {
  console.error(`\n${label} asks: ${question}`);
  const t0 = performance.now();
  const result = await request("POST", `/agents/${agentName(label)}/ask`, { question });
  const seconds = Math.round((performance.now() - t0) / 100) / 10;
  console.error(`${label} answered ${JSON.stringify(result.answer)} in ${seconds}s`);
  return { ...result, seconds };
}

/** Poll what matthew would retrieve until michelle's repo shows up, with a countdown. */
async function waitForExample(asker, repo) {
  const deadline = Date.now() + waitSeconds * 1000;
  const path = `/agents/${agentName(asker.label)}/examples?question=${encodeURIComponent(asker.question)}`;
  for (;;) {
    const examples = await request("GET", path);
    if (examples.some((e) => e.ref.startsWith(`${repo}@`))) {
      process.stderr.write(`\r${repo} is retrievable.${" ".repeat(30)}\n`);
      return true;
    }
    const left = Math.round((deadline - Date.now()) / 1000);
    if (left <= 0) {
      process.stderr.write(`\r${repo} not retrievable after ${waitSeconds}s; continuing anyway.\n`);
      return false;
    }
    for (let s = Math.min(pollSeconds, left); s > 0; s--) {
      process.stderr.write(`\rWaiting for Vectorize to index ${repo}: ${Math.round((deadline - Date.now()) / 1000)}s left `);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

const [first, second] = AGENTS;
const results = [];
results.push(await ask(first));
const firstRepo = `agent-${agentName(first.label)}`;
if (results[0].indexed) {
  await waitForExample(second, firstRepo);
} else {
  console.error(`${first.label}'s run was not indexed (no answer, or indexing failed); ${second.label} won't see it.`);
}
results.push(await ask(second));

const rows = [
  ["", ...AGENTS.map((a) => a.label)],
  ["question", ...AGENTS.map((a) => a.question)],
  ["answer", ...results.map((r) => String(r.answer))],
  // The first number in the answer, so "67 lamps" still counts.
  ["correct?", ...results.map((r, i) => (/-?\d+/.exec(String(r.answer))?.[0] === AGENTS[i].expected ? "yes" : `no (expected ${AGENTS[i].expected})`))],
  ["executions", ...results.map((r) => String(r.executions))],
  ["errors", ...results.map((r) => String(r.errors))],
  ["steps", ...results.map((r) => String(r.steps))],
  ["tokens in/out", ...results.map((r) => `${r.tokens.input}/${r.tokens.output}`)],
  ["seconds", ...results.map((r) => String(r.seconds))],
  ["indexed", ...results.map((r) => String(r.indexed))],
  ["examples used", ...results.map((r) => r.examples.join(", ") || "none")],
  ["commits", ...results.map((r) => r.commits.map((c) => (c.sha ? c.sha.slice(0, 12) : "unpushed")).join(" ") || "none")]
];
const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => row[col].length)));
console.log();
for (const row of rows) console.log(row.map((cell, col) => cell.padEnd(widths[col])).join("  ").trimEnd());
console.log(`\nrepos: ${AGENTS.map((a) => `agent-${agentName(a.label)}`).join(", ")}`);
