import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
  worker: {
    name: "codemode-git-example",
    compatibilityDate: "2026-09-30",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/index.ts",
    observability: { enabled: true },
    exports: {
      CodeAgent: exports.durableObject({ storage: "sqlite" })
    },
    env: {
      // One repo per agent in this namespace.
      ARTIFACTS: bindings.artifacts({ namespace: "codemode-git", dev: { remote: true } }),
      AGENT: bindings.durableObject({ worker: "codemode-git-example", exportName: "CodeAgent" }),
      LOADER: bindings.workerLoader(),
      // `ask`: the chat model and the embeddings for examples.
      AI: bindings.ai({ dev: { remote: true } }),
      // Answer-producing runs embedded as question + code, shared by all agents.
      EXAMPLES: bindings.vectorize({ name: "codemode-git-examples", dev: { remote: true } })
    }
  }
});
