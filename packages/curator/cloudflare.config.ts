import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
  worker: {
    name: "codemode-git-curator",
    compatibilityDate: "2026-09-30",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/index.ts",
    observability: { enabled: true },
    exports: {
      Curator: exports.durableObject({ storage: "sqlite" })
    },
    env: {
      // The namespace whose agent repos are curated. The skills repo lives here too.
      ARTIFACTS: bindings.artifacts({ namespace: "codemode-git", dev: { remote: true } }),
      AI: bindings.ai({ dev: { remote: true } }),
      LOADER: bindings.workerLoader(),
      CURATOR: bindings.durableObject({ worker: "codemode-git-curator", exportName: "Curator" })
    }
  }
});
