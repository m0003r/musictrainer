import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pwaBuildId = process.env.GITHUB_SHA ?? Date.now().toString(36);

export default defineConfig({
  base: "./",
  define: { __PWA_BUILD_ID__: JSON.stringify(pwaBuildId) },
  build: { manifest: "asset-manifest.json" },
  plugins: [react()],
  server: { port: 5173 }
});
