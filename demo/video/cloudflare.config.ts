import { bindings, defineConfig } from "cf/config";

// A local helper Worker for the video pipeline: `cf dev` runs it with your cf
// login, and scripts/voiceover.mjs calls it for text-to-speech and captions.
// The Workers AI binding always runs remotely, so no API token is needed.
export default defineConfig({
  worker: {
    name: "codemode-git-voiceover",
    compatibilityDate: "2026-09-30",
    entrypoint: "worker/index.ts",
    env: {
      AI: bindings.ai()
    }
  }
});
