#!/usr/bin/env node
// Generates the voiceover for every scene in src/script.ts with Workers AI:
// Deepgram Aura-2 for speech, Whisper for word timings (captions).
//
// Two ways to reach Workers AI:
//   1. The local helper Worker (default): `npm run tts-worker` in another
//      terminal, which uses your cf login. Override with VOICE_URL.
//   2. The REST API: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
//
// Writes public/voiceover/<scene>.mp3 and public/voiceover/manifest.json.
// A scene is regenerated only when its text or speaker changes.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scenes, SPEAKER } from "../src/script.ts";

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

const duration = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
const manifest = {};
let generated = 0;
for (const scene of scenes) {
  const hash = createHash("sha256").update(`${SPEAKER}\n${scene.voiceover}`).digest("hex").slice(0, 16);
  const file = `voiceover/${scene.id}.mp3`;
  const path = join(root, "public", file);
  if (previous[scene.id]?.hash === hash && existsSync(path)) {
    manifest[scene.id] = previous[scene.id];
    continue;
  }
  process.stderr.write(`${scene.id}: speaking ${scene.voiceover.length} chars… `);
  const audio = await retry("tts", () => speak(scene.voiceover));
  writeFileSync(path, audio);
  const words = (await retry("transcribe", () => transcribe(audio))).map((w) => ({ word: w.word, start: w.start, end: w.end }));
  manifest[scene.id] = { file, hash, seconds: duration(path), words };
  generated++;
  // Save progress, so a failure later doesn't lose this scene.
  writeFileSync(manifestPath, JSON.stringify({ ...previous, ...manifest }, null, 2) + "\n");
  process.stderr.write(`${manifest[scene.id].seconds.toFixed(1)}s\n`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const total = Object.values(manifest).reduce((s, m) => s + m.seconds, 0);
const chars = scenes.reduce((s, sc) => s + sc.voiceover.length, 0);
console.log(`${generated} scene(s) generated, ${scenes.length - generated} cached. Voiceover ${total.toFixed(1)}s total, ${chars} chars (~$${((chars / 1000) * 0.03).toFixed(2)} at Aura-2 pricing for a full regeneration).`);
