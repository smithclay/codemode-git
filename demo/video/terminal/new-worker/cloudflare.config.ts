import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "lava-agent",
		compatibilityDate: "2026-10-06",
		compatibilityFlags: ["nodejs_compat"],
		entrypoint,
		exports: { Agent: exports.durableObject({ storage: "sqlite" }) },
		env: {
			ARTIFACTS: bindings.artifacts({ namespace: "codemode-git" }),
			AGENT: bindings.durableObject({ worker: "lava-agent", exportName: "Agent" }),
			LOADER: bindings.workerLoader(),
		},
	},
});
