import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = path.join(root, "artifacts", "superdoc-node-result.json");
const result = {
  spike: "superdoc-node-jsdom",
  package: "superdoc@2.20.0",
  ok: false,
  status: "not-run",
  errors: [],
};

try {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="editor"></div></body></html>',
    { url: "http://wordhub.local", pretendToBeVisual: true },
  );
  const { window } = dom;
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    Text: window.Text,
    Comment: window.Comment,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    SVGElement: window.SVGElement,
    MutationObserver: window.MutationObserver,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    File: window.File,
    Blob: window.Blob,
    DOMParser: window.DOMParser,
    XMLSerializer: window.XMLSerializer,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
  };
  for (const [name, value] of Object.entries(globals)) {
    try {
      Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true,
      });
    } catch {}
  }
  window.matchMedia ??= () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
  const { SuperDoc } = await import("superdoc");
  const inputPath = path.join(root, "artifacts", "superdoc-chinese-input.docx");
  const bytes = await fs.readFile(inputPath);
  const source = new window.File([bytes], "中文.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const superdoc = new SuperDoc({
    selector: "#editor",
    document: source,
    documentMode: "editing",
    user: { name: "文枢", email: "wordhub@local" },
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("jsdom SuperDoc ready timeout")),
      10000,
    );
    superdoc.once("ready", () => {
      clearTimeout(timeout);
      resolve();
    });
    superdoc.once("content-error", ({ error }) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  result.status = "opened";
  result.editorVersion = superdoc.editorVersion;
  result.text = window.document.body.textContent?.trim().slice(0, 200) ?? "";
  result.ok = false;
  result.conclusion =
    "SuperDoc在Node/jsdom中可构造但不应作为P1后台DOCX写入路径；P1采用Markdown真相源，P4继续使用浏览器SuperDoc。";
  superdoc.destroy();
} catch (error) {
  result.status = "unsupported";
  result.errors.push(error instanceof Error ? error.message : String(error));
  result.conclusion =
    "本次Node/jsdom尝试未能完成编辑；SuperDoc依赖浏览器布局/Worker运行时，不能作为P1后台写入方案。";
}

await fs.mkdir(path.dirname(artifactPath), { recursive: true });
await fs.writeFile(artifactPath, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
