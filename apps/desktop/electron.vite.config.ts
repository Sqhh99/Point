import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Bundle @point/core from source so the app never depends on its dist/ at runtime.
const alias = {
  "@point/core/tree": resolve(import.meta.dirname, "../../packages/core/src/conversations/tree.ts"),
  "@point/core/rendered-map": resolve(import.meta.dirname, "../../packages/core/src/conversations/rendered-map.ts"),
  "@point/core/relocate": resolve(import.meta.dirname, "../../packages/core/src/docs/relocate.ts"),
  "@point/core": resolve(import.meta.dirname, "../../packages/core/src/index.ts")
};
const external = () => externalizeDepsPlugin({ exclude: ["@point/core"] });

export default defineConfig({
  main: { plugins: [external()], resolve: { alias } },
  preload: {
    plugins: [external()],
    resolve: { alias },
    // Sandboxed preloads cannot be ESM: emit CommonJS as out/preload/index.cjs.
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } }
  },
  // .pfb/.bcmap are pdf.js font/CMap binaries; declaring them assets lets `?inline` bundle them as lazy chunks.
  renderer: { plugins: [react()], resolve: { alias }, assetsInclude: ["**/*.pfb", "**/*.bcmap"] }
});
