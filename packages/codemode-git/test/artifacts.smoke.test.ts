// Pushes real commits to an Artifacts repo through ArtifactsSink. Skipped
// unless SMOKE_REMOTE (the repo's git remote) and SMOKE_TOKEN (a write token)
// are set. Only the binding is faked; git traffic is real.
import { describe, expect, it } from "vitest";
import type { ExecutionState } from "@cloudflare/codemode";
import { toCommit } from "../src/format";
import { ArtifactsSink } from "../src/sink";

const remote = process.env.SMOKE_REMOTE;
const token = process.env.SMOKE_TOKEN;

function fakeBinding(state: { lastPushAt: string | null }): Artifacts {
  const repo = {
    info: async () => ({ remote, lastPushAt: state.lastPushAt }),
    createToken: async () => ({
      plaintext: token,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    }),
    readFile: async () => null,
    [Symbol.dispose]() {}
  };
  return { get: async () => repo } as unknown as Artifacts;
}

const exec = (code: string): ExecutionState => ({
  id: `exec_${code}`,
  code: `// smoke ${code}\nasync () => "${code}"`,
  status: "completed",
  log: [],
  result: code,
  connectors: [],
  createdAt: Date.now(),
  updatedAt: Date.now()
});

describe.skipIf(!remote || !token)("ArtifactsSink against a real repo", () => {
  it("commits on a fresh repo, then again from a cold clone", async () => {
    const state = { lastPushAt: null as string | null };
    const first = new ArtifactsSink({ artifacts: fakeBinding(state), repo: "smoke" });
    const sha1 = await first.commit(toCommit(exec("one"), "completed", "smoke one"));
    const sha2 = await first.commit(toCommit(exec("two"), "completed", "smoke two"));
    expect(sha1).not.toBe(sha2);

    // Artifacts can leave lastPushAt null after git pushes; a cold sink must still clone.
    const cold = new ArtifactsSink({ artifacts: fakeBinding(state), repo: "smoke" });
    const sha3 = await cold.commit(toCommit(exec("three"), "error", "smoke three"));
    expect(sha3).toMatch(/^[0-9a-f]{40}$/);

    // A null file deletes it.
    const added = await cold.commit({ message: "smoke add", files: { "scratch.txt": "x" }, timestamp: Date.now() });
    const removed = await cold.commit({ message: "smoke delete", files: { "scratch.txt": null }, timestamp: Date.now() });
    expect(removed).not.toBe(added);
  }, 60_000);
});
