import git from "isomorphic-git";
import { describe, expect, it } from "vitest";
import type { ExecutionState } from "@cloudflare/codemode";
import { FILES, defaultIntent, parseTrailers, snippetsUsed, toCommit } from "../src/format";
import { MemoryFS } from "../src/memory-fs";

const exec: ExecutionState = {
  id: "exec_1",
  code: `// Find the cheapest lamp\nasync () => {\n  const page = await catalog.search({ query: "lamp" });\n  return codemode.run("cheapest", page);\n}`,
  status: "completed",
  log: [
    { seq: 0, connector: "catalog", method: "search", args: { query: "lamp" }, result: [1], requiresApproval: false, state: "applied" }
  ],
  result: { id: 3 },
  connectors: ["catalog", "history"],
  createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_001_000
};

describe("format", () => {
  it("derives intent from the leading comment", () => {
    expect(defaultIntent(exec)).toBe("Find the cheapest lamp");
  });

  it("finds snippets invoked with codemode.run", () => {
    expect(snippetsUsed(exec.code)).toEqual(["cheapest"]);
  });

  it("round-trips trailers through the commit message", () => {
    const commit = toCommit(exec, "completed", "Find the cheapest lamp");
    expect(commit.message.split("\n")[0]).toBe("Find the cheapest lamp");
    expect(parseTrailers(commit.message)).toEqual({
      "Codemode-Execution": "exec_1",
      "Codemode-Status": "completed",
      "Codemode-Connectors": "catalog, history",
      "Codemode-Snippets": "cheapest"
    });
    expect(commit.files[FILES.calls]!.trim().split("\n")).toHaveLength(1);
  });
});

describe("MemoryFS + isomorphic-git", () => {
  it("can init, commit twice and read the log", async () => {
    const fs = new MemoryFS();
    const dir = "/repo";
    const author = { name: "t", email: "t@t", timestamp: 1_760_000_000, timezoneOffset: 0 };
    await git.init({ fs, dir, defaultBranch: "main" });
    for (const [i, content] of ["one", "two"].entries()) {
      const { files, message } = toCommit({ ...exec, code: content }, "completed", `run ${i}`);
      for (const [path, data] of Object.entries(files)) {
        await fs.promises.writeFile(`${dir}/${path}`, data);
        await git.add({ fs, dir, filepath: path });
      }
      await git.commit({ fs, dir, message, author });
    }
    const log = await git.log({ fs, dir });
    expect(log.map((c) => c.commit.message.split("\n")[0])).toEqual(["run 1", "run 0"]);
    const blob = await git.readBlob({ fs, dir, oid: log[0]!.oid, filepath: FILES.code });
    expect(new TextDecoder().decode(blob.blob)).toBe("two\n");
  });
});
