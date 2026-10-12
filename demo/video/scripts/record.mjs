#!/usr/bin/env node
// Records a terminal scene with VHS and encodes it for the video:
//   node scripts/record.mjs [new-worker]
// VHS writes text and cursor frames to frames-<name>/; ffmpeg
// overlays them, centers them on a 1920×1080 background, and writes
// public/clips/<name>.mp4, and records its length in public/clips/index.json.
// <name> must be the id of the scene that plays it. (VHS's built-in encoding
// fails silently with ffmpeg 9.)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2] ?? "new-worker";
// VHS only writes frames to a single-level directory, so: frames-<name>/.
const frames = join(root, `frames-${name}`);
const out = join(root, "public/clips", `${name}.mp4`);

rmSync(frames, { recursive: true, force: true });
// It must not exist beforehand either: VHS writes nothing into an existing one.
execFileSync("vhs", [join("terminal", `${name}.tape`)], { cwd: root, stdio: "inherit" });
if (!existsSync(join(frames, "frame-text-00001.png"))) throw new Error(`VHS wrote no frames to ${frames}`);

mkdirSync(dirname(out), { recursive: true });
execFileSync("ffmpeg", [
  "-v", "error", "-y",
  "-framerate", "30", "-i", join(frames, "frame-text-%05d.png"),
  "-framerate", "30", "-i", join(frames, "frame-cursor-%05d.png"),
  "-filter_complex",
  "[0][1]overlay,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0f1115,format=yuv420p",
  "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart",
  out
], { stdio: "inherit" });
rmSync(frames, { recursive: true, force: true });

// index.json maps each recorded scene to its clip's length, so the scene
// lasts at least as long as the recording.
const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString());
const indexPath = join(root, "public/clips/index.json");
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
writeFileSync(indexPath, JSON.stringify({ ...index, [name]: Math.round(seconds * 10) / 10 }, null, 2) + "\n");
console.log(`${out}: ${seconds.toFixed(1)}s; listed in public/clips/index.json`);
