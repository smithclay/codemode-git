#!/usr/bin/env node
// Prints a short-lived read token for one agent's Artifacts repo, for the
// terminal recordings (used off camera, so the token never appears on screen).
//   node scripts/artifacts-token.mjs agent-<name> [ttl-seconds]
import { execFileSync } from "node:child_process";

const [repo, ttl = "900"] = process.argv.slice(2);
if (!repo) throw new Error("usage: artifacts-token.mjs <repo> [ttl-seconds]");
const out = execFileSync("npx", ["cf", "artifacts", "namespaces", "tokens", "create", "codemode-git", "--repo", repo, "--scope", "read", "--ttl", ttl], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"]
});
const secret = /"plaintext":\s*"([^"?]+)/.exec(out)?.[1];
if (!secret) throw new Error("no token in cf output");
process.stdout.write(secret);
