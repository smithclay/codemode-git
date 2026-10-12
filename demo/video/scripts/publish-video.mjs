#!/usr/bin/env node
// Publishes the demo video for the README:
//   npm run publish-video            (renders first)
//   npm run publish-video -- --no-render
// Renders out/demo.mp4, uploads it as codemode-git-demo.mp4 to the
// `demo-video` GitHub release (created if missing, never marked latest), and
// refreshes the README poster at docs/assets/demo-poster.jpg.

import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
const TAG = "demo-video";
const asset = join(root, "out/codemode-git-demo.mp4");

if (!process.argv.includes("--no-render")) run("npx", ["remotion", "render", "Demo", "out/demo.mp4"]);
copyFileSync(join(root, "out/demo.mp4"), asset);

run("npx", ["remotion", "still", "Poster", "out/poster.png"]);
run("ffmpeg", ["-v", "error", "-y", "-i", "out/poster.png", "-vf", "scale=1280:-1", "-q:v", "3", "../../docs/assets/demo-poster.jpg"]);

try {
  execFileSync("gh", ["release", "view", TAG], { cwd: root, stdio: "ignore" });
} catch {
  run("gh", ["release", "create", TAG, "--title", "Demo video", "--notes", "The competition demo video, rendered from demo/video. Linked from the README.", "--latest=false"]);
}
run("gh", ["release", "upload", TAG, asset, "--clobber"]);
console.log(`Uploaded. README link: https://github.com/smithclay/codemode-git/releases/download/${TAG}/codemode-git-demo.mp4`);
