import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
  worker: {
    name: "codemode-git-dabstep",
    compatibilityDate: "2026-09-30",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/index.ts",
    observability: { enabled: true },
    exports: {
      Solver: exports.durableObject({ storage: "sqlite" }),
      DabstepCurator: exports.durableObject({ storage: "sqlite" })
    },
    env: {
      // DABstep context data (scripts/build_sql.py), read-only to agents.
      DB: bindings.d1({ name: "dabstep", id: "48e79343-ad47-46a5-9c74-555e3f884f1c", dev: { remote: true } }),
      ARTIFACTS: bindings.artifacts({ namespace: "codemode-git", dev: { remote: true } }),
      AI: bindings.ai({ dev: { remote: true } }),
      LOADER: bindings.workerLoader(),
      // Answer-producing runs embedded as question + code (codemode-git-examples arm).
      EXAMPLES: bindings.vectorize({ name: "codemode-git-examples", dev: { remote: true } }),
      // HARNESS_TOKEN: set with `cf workers secrets update`. Every non-localhost
      // request needs it as a bearer token; without it the worker rejects all.
      SOLVER: bindings.durableObject({ worker: "codemode-git-dabstep", exportName: "Solver" }),
      CURATOR: bindings.durableObject({ worker: "codemode-git-dabstep", exportName: "DabstepCurator" })
    }
  }
});
