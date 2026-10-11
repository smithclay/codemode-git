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
      // Agent repos live in this namespace; the curator subscribes to the whole namespace.
      ARTIFACTS: bindings.artifacts({ namespace: "codemode-git", dev: { remote: true } }),
      AGENT: bindings.durableObject({ worker: "codemode-git-example", exportName: "CodeAgent" }),
      LOADER: bindings.workerLoader()
    }
  }
});
