import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(here, "src/main/index.ts"),
          worker: path.resolve(here, "src/worker/index.ts")
        },
        output: {
          entryFileNames: "[name].js"
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: path.resolve(here, "src/preload/index.ts"),
        output: { format: "cjs", entryFileNames: "index.cjs" }
      }
    }
  },
  renderer: {
    root: path.resolve(here, "src/renderer"),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: path.resolve(here, "src/renderer/index.html")
      }
    }
  }
});
