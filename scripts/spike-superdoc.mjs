import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Packer,
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
} from "docx";
import { chromium } from "playwright";
import yauzl from "yauzl";

const readZipEntry = (buffer, wanted) =>
  new Promise((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      zip.readEntry();
      zip.on("entry", (entry) => {
        if (entry.fileName === wanted)
          zip.openReadStream(entry, (err, stream) => {
            if (err) return reject(err);
            const chunks = [];
            stream.on("data", (chunk) => chunks.push(chunk));
            stream.on("end", () =>
              resolve(Buffer.concat(chunks).toString("utf8")),
            );
          });
        else zip.readEntry();
      });
      zip.on("error", reject);
    }),
  );

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
await fs.mkdir(artifacts, { recursive: true });
const inputPath = path.join(artifacts, "superdoc-chinese-input.docx");
const outputPath = path.join(artifacts, "superdoc-chinese-output.docx");
const sample = new Document({
  sections: [
    {
      children: [
        new Paragraph({
          text: "文枢中文DOCX技术验证",
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({
          children: [
            new TextRun("这是包含中文、标点和Agent版本锚点的测试段落。"),
          ],
        }),
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("字段")] }),
                new TableCell({ children: [new Paragraph("值")] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("状态")] }),
                new TableCell({ children: [new Paragraph("候选版本")] }),
              ],
            }),
          ],
        }),
      ],
    },
  ],
});
await fs.writeFile(inputPath, await Packer.toBuffer(sample));

const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/node_modules/superdoc/dist/style.css"><div id="superdoc-root" style="height:900px"></div><script>window.SUPERDOC_ENGINE_CDN_BASE_URL='/node_modules/@superdoc/docx-engine';</script><script src="/node_modules/superdoc/dist-cdn/superdoc.min.js"></script><script>
window.ready = new Promise((resolve) => {
  window.__wordhubSuperDoc = new window.SuperDoc({ selector: '#superdoc-root', document: '/artifacts/superdoc-chinese-input.docx', telemetry: { enabled: false }, onReady: () => resolve(true), onException: (e) => { window.__superdocException = e; } });
});
</script>`;
const htmlPath = path.join(artifacts, "superdoc-spike.html");
await fs.writeFile(htmlPath, html);
const server = http.createServer(async (req, res) => {
  const requested = decodeURIComponent(
    new URL(req.url, "http://127.0.0.1").pathname,
  );
  const safe = path.resolve(root, `.${requested}`);
  if (!safe.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const body = await fs.readFile(safe);
    const type = safe.endsWith(".html")
      ? "text/html"
      : safe.endsWith(".js")
        ? "text/javascript"
        : safe.endsWith(".css")
          ? "text/css"
          : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/artifacts/superdoc-spike.html`);
let opened = false,
  htmlText = "",
  exportedBytes = 0,
  editAttempt = null,
  inspected = null,
  exportShape = null,
  outputContainsEdit = false;
try {
  await page.waitForTimeout(3000);
  await page.waitForTimeout(1500);
  opened = true;
  inspected = await page.evaluate(() => ({
    html: window.__wordhubSuperDoc.activeEditor?.getHTML?.() ?? [],
    rootText: document.querySelector("#superdoc-root")?.innerText ?? "",
    bodyText: document.body.innerText,
    keys: Object.keys(window.__wordhubSuperDoc),
    proto: Object.getOwnPropertyNames(
      Object.getPrototypeOf(window.__wordhubSuperDoc),
    ),
    version: window.__wordhubSuperDoc.version,
    active: Boolean(window.__wordhubSuperDoc.activeEditor),
    activeKeys: window.__wordhubSuperDoc.activeEditor
      ? Object.keys(window.__wordhubSuperDoc.activeEditor)
      : [],
    authoringKeys: window.__wordhubSuperDoc.activeEditor?.authoring
      ? Object.keys(window.__wordhubSuperDoc.activeEditor.authoring)
      : [],
    editCommandsKeys: window.__wordhubSuperDoc.activeEditor?.editCommands
      ? Object.keys(window.__wordhubSuperDoc.activeEditor.editCommands)
      : [],
    commandsKeys: window.__wordhubSuperDoc.activeEditor?.commands
      ? Object.keys(window.__wordhubSuperDoc.activeEditor.commands)
      : [],
    configDocs: window.__wordhubSuperDoc.config?.documents ?? null,
    storeDocs:
      window.__wordhubSuperDoc.superdocStore?.documents?.map?.((x) => ({
        id: x.id,
        type: x.type,
        ready: x.isReady,
      })) ?? null,
    exception: window.__superdocException ?? null,
  }));
  htmlText =
    JSON.stringify(inspected.html) + inspected.rootText + inspected.bodyText;
  editAttempt = await page.evaluate(async () =>
    window.__wordhubSuperDoc.activeEditor.authoring.replaceTextByText({
      findText: "文枢中文DOCX技术验证",
      replacement: "文枢中文DOCX已写回",
      occurrence: 0,
      mode: "direct",
    }),
  );
  const exported = await page.evaluate(async () => {
    const active = window.__wordhubSuperDoc.activeEditor;
    if (!active || typeof active.exportDocx !== "function") return null;
    const value = await active.exportDocx();
    if (value instanceof Blob)
      return {
        kind: "blob",
        bytes: Array.from(new Uint8Array(await value.arrayBuffer())),
      };
    if (value instanceof ArrayBuffer)
      return { kind: "arraybuffer", bytes: Array.from(new Uint8Array(value)) };
    if (value?.bytes) return { kind: "bytes", bytes: Array.from(value.bytes) };
    return { kind: typeof value, keys: Object.keys(value ?? {}) };
  });
  exportShape = exported && { kind: exported.kind, keys: exported.keys };
  exportedBytes = exported?.bytes?.length ?? 0;
  if (exported?.bytes) {
    await fs.writeFile(outputPath, Buffer.from(exported.bytes));
    const xml = await readZipEntry(
      Buffer.from(exported.bytes),
      "word/document.xml",
    );
    outputContainsEdit = xml.includes("文枢中文DOCX已写回");
  }
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}
await browser.close();
server.close();
const result = {
  spike: "superdoc-chinese-docx",
  package: "superdoc@2.20.0",
  input: path.relative(root, inputPath),
  output: path.relative(root, outputPath),
  opened,
  chineseTextFound: /文枢中文DOCX技术验证/.test(htmlText),
  inspection: inspected,
  editAttempt,
  outputContainsEdit,
  exportShape,
  exportedBytes,
  ok:
    opened &&
    /文枢中文DOCX技术验证/.test(htmlText) &&
    editAttempt?.ok === true &&
    outputContainsEdit &&
    exportedBytes > 1000,
  errors: [...errors],
};
await fs.writeFile(
  path.join(artifacts, "superdoc-result.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
