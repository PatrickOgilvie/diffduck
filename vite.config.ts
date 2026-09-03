import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const shikiWebAdapter = resolve(import.meta.dirname, "src/ui/shiki-web.ts");
const unavailableShikiWasm = resolve(import.meta.dirname, "src/ui/shiki-wasm-unavailable.ts");

export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { strict: true, allow: [import.meta.dirname] },
  },
  resolve: {
    // DiffDuck accepts a deliberately small language set. The exact alias keeps
    // Shiki's full grammar catalogue out of the single-file MCP resource.
    alias: [
      { find: /^shiki$/, replacement: shikiWebAdapter },
      { find: /^shiki\/wasm$/, replacement: unavailableShikiWasm },
    ],
  },
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: {
      input: resolve(import.meta.dirname, "mcp-app.html"),
    },
  },
});
