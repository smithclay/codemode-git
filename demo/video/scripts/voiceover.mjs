#!/usr/bin/env node
// Generates the voiceover for every scene with Workers AI, from the text in
// transcript.md (one "## <scene id>" section per scene in src/script.ts):
// Deepgram Aura-2 for speech, Whisper for word timings (captions).
//
// Two ways to reach Workers AI:
//   1. The local helper Worker (default): `npm run tts-worker` in another
//      terminal, which uses your cf login. Override with VOICE_URL.
//   2. The REST API: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
//
// Writes public/voiceover/<scene>.mp3 and public/voiceover/manifest.json
// (with the text each clip was generated from, for captions). A scene is
// regenerated only when its text or speaker changes.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sceneSeconds, scenes, SPEAKER } from "../src/script.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public/voiceover");
const manifestPath = join(outDir, "manifest.json");
mkdirSync(outDir, { recursive: true });

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const voiceUrl = process.env.VOICE_URL ?? "http://localhost:8788";
const rest = (model) => `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;

async function speak(text) {
  const res =
    token && account
      ? await fetch(rest("@cf/deepgram/aura-2-en"), {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ text, speaker: SPEAKER, encoding: "mp3" })
        })
      : await fetch(`${voiceUrl}/tts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, speaker: SPEAKER })
        });
  if (!res.ok) throw new Error(`tts: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function transcribe(audio) {
  const res =
    token && account
      ? await fetch(rest("@cf/openai/whisper"), { method: "POST", headers: { authorization: `Bearer ${token}` }, body: audio })
      : await fetch(`${voiceUrl}/transcribe`, { method: "POST", body: audio });
  if (!res.ok) throw new Error(`transcribe: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return (body.result ?? body).words ?? [];
}

// Workers AI occasionally drops a connection; retry a few times.
async function retry(label, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 4) throw err;
      process.stderr.write(`(${label} failed: ${String(err.message ?? err).slice(0, 80)}; retrying) `);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// "## <id>" sections; HTML comments are dropped and lines joined.
function readTranscript() {
  const md = readFileSync(join(root, "transcript.md"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const sections = {};
  let id = null;
  for (const line of md.split("\n")) {
    const heading = /^##\s+(.*?)\s*$/.exec(line);
    if (heading) {
      id = heading[1];
      if (/\s/.test(id)) throw new Error(`transcript.md: "## ${id}" — scene ids can't contain spaces (use "${id.replace(/\s+/g, "-")}" and match src/script.ts)`);
      if (id in sections) throw new Error(`transcript.md: duplicate section "## ${id}"`);
      sections[id] = [];
    } else if (id) {
      sections[id].push(line.trim());
    }
  }
  const text = Object.fromEntries(Object.entries(sections).map(([k, lines]) => [k, lines.filter(Boolean).join(" ")]));
  const ids = scenes.map((s) => s.id);
  const missing = ids.filter((k) => !text[k]);
  const extra = Object.keys(text).filter((k) => !ids.includes(k));
  if (missing.length || extra.length) {
    throw new Error(
      `transcript.md doesn't match src/script.ts.` +
        (missing.length ? ` Missing or empty: ${missing.join(", ")}.` : "") +
        (extra.length ? ` Unknown sections: ${extra.join(", ")}.` : "")
    );
  }
  return text;
}

const duration = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

const transcript = readTranscript();
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
const manifest = {};
let generated = 0;
for (const scene of scenes) {
  const text = transcript[scene.id];
  const hash = createHash("sha256").update(`${SPEAKER}\n${text}`).digest("hex").slice(0, 16);
  const file = `voiceover/${scene.id}.mp3`;
  const path = join(root, "public", file);
  if (previous[scene.id]?.hash === hash && existsSync(path)) {
    manifest[scene.id] = { ...previous[scene.id], text };
    continue;
  }
  process.stderr.write(`${scene.id}: speaking ${text.length} chars… `);
  const audio = await retry("tts", () => speak(text));
  writeFileSync(path, audio);
  const words = (await retry("transcribe", () => transcribe(audio))).map((w) => ({ word: w.word, start: w.start, end: w.end }));
  manifest[scene.id] = { file, hash, text, seconds: duration(path), words };
  generated++;
  // Save progress, so a failure later doesn't lose this scene.
  writeFileSync(manifestPath, JSON.stringify({ ...previous, ...manifest }, null, 2) + "\n");
  process.stderr.write(`${manifest[scene.id].seconds.toFixed(1)}s\n`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const chars = Object.values(transcript).reduce((s, t) => s + t.length, 0);
console.log(`${generated} scene(s) generated, ${scenes.length - generated} cached. ${chars} chars (~$${((chars / 1000) * 0.03).toFixed(2)} at Aura-2 pricing for a full regeneration).\n`);

// Runtime report: what the composition will use, scene by scene.
const clipsPath = join(root, "public/clips/index.json");
const clips = existsSync(clipsPath) ? JSON.parse(readFileSync(clipsPath, "utf8")) : [];
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
let runtime = 0;
for (const scene of scenes) {
  const seconds = sceneSeconds(scene, manifest[scene.id].seconds, clips.includes(scene.id));
  const slot = scene.minSeconds ? (clips.includes(scene.id) ? `  recording (${scene.minSeconds}s)` : `  recording slot empty (+${Math.max(0, scene.minSeconds - seconds).toFixed(0)}s when filled)`) : "";
  console.log(`${fmt(runtime).padStart(5)}  ${scene.id.padEnd(16)} ${seconds.toFixed(1).padStart(5)}s${slot}`);
  runtime += seconds;
}
console.log(`\nRuntime ${fmt(runtime)}.` + (runtime < 300 ? ` Under the 5:00 minimum by ${Math.ceil(300 - runtime)}s; filling the recording slots adds time.` : ""));
