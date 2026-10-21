// Asks the deck agent to build every slide that has no program yet, one
// message per slide, the same as pressing G on each. Slides that already
// exist are left alone; pass ids to rebuild specific ones. Builds use high
// reasoning effort: slower, but low effort cuts corners on a blank slide.
//
//   npm run build-slides                       (npm run dev in another terminal)
//   npm run build-slides -- hook curve         (rebuild these)
// It talks to local dev: a deployed deck's agent is behind Cloudflare Access.
// Both write to the same deck-slides repo; reload the deployed deck after.

const base = (process.env.DECK_URL ?? "http://localhost:5173").replace(/\/$/, "");
const headers = { "content-type": "application/json" };
const only = process.argv.slice(2);

const deck = await (await fetch(`${base}/api/deck`)).json();
const todo = deck.slides.filter((s) => (only.length ? only.includes(s.id) : !s.slide));
console.log(`${todo.length} slides to build: ${todo.map((s) => s.id).join(", ") || "none"}`);

for (const s of todo) {
  const started = Date.now();
  const verb = s.slide ? "Rewrite" : "Build";
  const res = await fetch(`${base}/api/agent`, { method: "POST", headers, body: JSON.stringify({ message: `${verb} slide ${s.id} from its outline prompt.`, current: s.id, effort: "high" }) });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  const secs = Math.round((Date.now() - started) / 1000);
  if (body.error) console.log(`✗ ${s.id} (${secs}s): ${body.error}`);
  else console.log(`${body.changed.includes(s.id) ? "✓" : "·"} ${s.id} (${secs}s, ${body.steps} steps, ${body.tokens} tokens): ${body.reply}`);
}
