import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(here, "..", "frontend"),
  resolve: {
    alias: {
      "bpmn-js": resolve(here, "node_modules", "bpmn-js"),
      "bpmn-js-i18n": resolve(here, "node_modules", "bpmn-js-i18n"),
      mermaid: resolve(here, "node_modules", "mermaid"),
    },
  },
  server: {
    host: process.env.VITE_HOST || "0.0.0.0",
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    // frontend/ is the Vite root, while npm dependencies live in scripts/.
    // Allow the repository root so bpmn-js font assets can be served in dev.
    fs: {
      allow: [resolve(here, "..")],
    },
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.API_PORT || 3000}`,
        changeOrigin: true,
      },
      "/health": {
        target: `http://127.0.0.1:${process.env.API_PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
