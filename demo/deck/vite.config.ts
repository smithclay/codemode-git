import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One build for both halves: the presenter (src/client) as static assets, and
// the Worker (src/worker) that writes slides with Code Mode.
export default defineConfig({
  plugins: [react(), cloudflare()],
  // The deck reads the video's theme, data and transcript from ../video.
  server: { fs: { allow: [".."] } }
});
