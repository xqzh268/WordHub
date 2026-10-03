import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

// 生产构建注入 CSP：只允许自身资源。开发模式下 HMR 需要内联脚本，所以仅在 build 时启用。
const csp = {
  name: "wordhub-csp",
  apply: "build" as const,
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: {
        "http-equiv": "Content-Security-Policy",
        content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"
      },
      injectTo: "head-prepend" as const
    }
  ]
};

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
    plugins: [react(), csp],
    build: {
      rollupOptions: {
        input: path.resolve(here, "src/renderer/index.html")
      }
    }
  }
});
