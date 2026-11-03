// 参考库端到端（mock 后台，Electron）：
// 导入 TXT(UTF-8/GB18030)、EPUB、DOCX、中文 PDF（由 Chromium 打印生成），以及会被拒绝的 DRM EPUB / 无文字层 PDF / MOBI；
// 阅读、全文检索并跳到命中处、选段 → 提问 / 作为文风示范 / 复制引用，文风示范上限、删除、重启后仍在，以及版面断言。
// 用法：npm run build:desktop && node scripts/references-e2e.mjs
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import iconv from "iconv-lite";
import JSZip from "jszip";
import { _electron } from "playwright";
import { closeApp } from "./lib/close-app.mjs";

const { ELECTRON_RUN_AS_NODE, DEEPSEEK_API_KEY, ...baseEnv } = process.env;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-refs-e2e-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
const inbox = path.join(tmp, "收件箱");
fs.mkdirSync(folder, { recursive: true });
fs.mkdirSync(inbox, { recursive: true });

const findings = [];
const check = (name, passed, detail = "") => {
  findings.push({ name, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}`,
  );
  return passed;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 夹具 ────────────────────────────────────────────────────
const para = (label) =>
  `${label}里，裴照提着灯笼走进崇仁坊。三更鼓响过，暮色像一层薄薄的灰，压在坊墙之上，风从城门那边吹来，带着一点潮气。`;
const novel = (tag) =>
  [
    `第一章 夜巡\n${para(`${tag}第一章`)}\n${para("他停住脚步")}`,
    `第二章 残月\n${para(`${tag}第二章`)}\n${para("残月悬在天边")}`,
    `第三章 归来\n${para(`${tag}第三章`)}\n${para("他终于回到崇仁坊")}`,
  ].join("\n\n");

const utf8Txt = path.join(inbox, "长安夜.txt");
fs.writeFileSync(utf8Txt, `长安夜\n\n${novel("甲")}`, "utf8");
const gbkTxt = path.join(inbox, "旧书.txt");
fs.writeFileSync(gbkTxt, iconv.encode(`旧书\n\n${novel("乙")}`, "gb18030"));

async function epub(withDrm) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  if (withDrm)
    zip.file(
      "META-INF/encryption.xml",
      '<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>',
    );
  zip.file(
    "OEBPS/content.opf",
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>电子书样本</dc:title><dc:creator>某作者</dc:creator></metadata><manifest><item id="c0" href="c0.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c0"/><itemref idref="c1"/></spine></package>',
  );
  zip.file(
    "OEBPS/c0.xhtml",
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>序幕</h1><p>${para("序幕")}</p></body></html>`,
  );
  zip.file(
    "OEBPS/c1.xhtml",
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>终幕</h1><p>${para("终幕")}</p></body></html>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}
const epubFile = path.join(inbox, "电子书样本.epub");
fs.writeFileSync(epubFile, await epub(false));
const drmFile = path.join(inbox, "受保护.epub");
fs.writeFileSync(drmFile, await epub(true));

const docxFile = path.join(inbox, "文档样本.docx");
fs.writeFileSync(
  docxFile,
  await Packer.toBuffer(
    new Document({
      title: "文档样本",
      sections: [
        {
          children: [
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              children: [new TextRun("开端")],
            }),
            new Paragraph({ children: [new TextRun(para("开端"))] }),
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              children: [new TextRun("收束")],
            }),
            new Paragraph({ children: [new TextRun(para("收束"))] }),
          ],
        },
      ],
    }),
  ),
);

// 扫描件式 PDF：只有页面，没有文字
const scanPdf = path.join(inbox, "扫描件.pdf");
fs.writeFileSync(
  scanPdf,
  Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\ntrailer\n<< /Size 4 /Root 1 0 R >>\n%%EOF",
    "latin1",
  ),
);
const mobiFile = path.join(inbox, "旧电子书.mobi");
fs.writeFileSync(mobiFile, "BOOKMOBI");

let app;
let page;
const launch = async () => {
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [
      path.join(root, "out", "main", "index.js"),
      `--user-data-dir=${userData}`,
    ],
    cwd: root,
    env: { ...baseEnv, WORDHUB_MOCK: "1", WORDHUB_WORKSPACE_ROOT: root },
  });
  page = await app.firstWindow();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.waitForSelector(".app");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="worker-status"]')
        ?.textContent?.includes("待命"),
    null,
    { timeout: 30000 },
  );
};
const stubOpenDialog = (lists) =>
  app.evaluate(({ dialog }, answers) => {
    let call = 0;
    dialog.showOpenDialog = async () => {
      const files = answers[Math.min(call++, answers.length - 1)];
      return { canceled: files.length === 0, filePaths: files };
    };
  }, lists);
const openRefs = async () => {
  await page.click('[data-testid="rail-references"]');
  await page.waitForSelector('[data-testid="references"]');
};
const message = async () =>
  (await page
    .locator('[data-testid="ref-message"]')
    .textContent()
    .catch(() => "")) ?? "";

try {
  await launch();

  // 用 Chromium 自己把中文 HTML 打印成带文字层的 PDF
  const pdfBase64 = await app.evaluate(
    async ({ BrowserWindow }, html) => {
      const win = new BrowserWindow({ show: false });
      await win.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
      );
      const data = await win.webContents.printToPDF({});
      win.destroy();
      return data.toString("base64");
    },
    `<html><body style="font-family:SimSun,serif;font-size:16px;line-height:1.8">${novel(
      "丙",
    )
      .split("\n")
      .map((line) =>
        /^第.章/u.test(line) ? `<h2>${line}</h2>` : `<p>${line}</p>`,
      )
      .join("")}</body></html>`,
  );
  const pdfFile = path.join(inbox, "中文论文.pdf");
  fs.writeFileSync(pdfFile, Buffer.from(pdfBase64, "base64"));

  // 没链接项目时的提示
  await openRefs();
  check(
    "没有链接项目时提示先链接文件夹",
    (await page.locator('[data-testid="references"]').textContent())?.includes(
      "先链接写作文件夹",
    ) ?? false,
  );
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  await page.click('[data-testid="rail-workspace"]');
  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]');
  await openRefs();
  await page.waitForSelector('[data-testid="ref-empty"]');
  check("空库显示引导文案", true);

  // ── 导入五种可用格式 ─────────────────────────────────────
  await stubOpenDialog([
    [utf8Txt, gbkTxt, epubFile, docxFile, pdfFile],
    [drmFile, scanPdf, mobiFile, utf8Txt],
    [],
  ]);
  await page.click('[data-testid="ref-import"]');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="ref-ref-"]').length >= 5,
    null,
    { timeout: 60000 },
  );
  const cards = await page.$$eval(
    '[data-testid^="ref-ref-"] .ref-card',
    (items) => items.map((item) => item.textContent ?? ""),
  );
  check(
    "五份资料都导入成功",
    cards.length === 5,
    cards.join(" | ").slice(0, 300),
  );
  for (const [needle, label] of [
    ["TXT", "TXT"],
    ["EPUB", "EPUB"],
    ["DOCX", "DOCX"],
    ["PDF", "PDF"],
  ])
    check(
      `列表标出了格式：${label}`,
      cards.some((text) => text.includes(needle)),
    );
  check(
    "导入提示列出了书名",
    (await message()).includes("已导入 5 份"),
    await message(),
  );

  // 每种格式都能读到正确的章节与中文正文
  const openByTitle = async (title) => {
    await page.locator(".ref-card", { hasText: title }).first().click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="ref-text"] p') !== null,
      null,
      { timeout: 10000 },
    );
  };
  const textNow = async () =>
    (await page.locator('[data-testid="ref-text"]').textContent()) ?? "";
  await openByTitle("长安夜");
  check(
    "UTF-8 TXT：读到第一章正文",
    (await textNow()).includes("甲第一章里，裴照提着灯笼"),
  );
  await openByTitle("旧书");
  check(
    "GB18030 TXT：中文没有乱码",
    (await textNow()).includes("乙第一章里，裴照提着灯笼"),
  );
  await openByTitle("电子书样本");
  check(
    "EPUB：按 spine 取到章节与正文",
    (await textNow()).includes("序幕里，裴照"),
  );
  await openByTitle("文档样本");
  check(
    "DOCX：按标题分章并读到正文",
    (await textNow()).includes("开端里，裴照"),
  );
  await openByTitle("中文论文");
  const pdfText = await textNow();
  check(
    "中文 PDF（Chromium 生成）：提取出文字层",
    pdfText.includes("裴照提着灯笼走进崇仁坊"),
    pdfText.slice(0, 80),
  );

  // ── 被拒绝的文件：第二次导入 ─────────────────────────────
  await page.click('[data-testid="ref-import"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="ref-message"]')
        ?.textContent?.includes("导入失败"),
    null,
    { timeout: 30000 },
  );
  const failText = await message();
  check(
    "DRM EPUB 被明确拒绝",
    failText.includes("受保护.epub") && failText.includes("DRM"),
    failText.slice(0, 200),
  );
  check(
    "无文字层 PDF 被明确拒绝（不做 OCR）",
    failText.includes("扫描件.pdf") && failText.includes("没有可提取的文字层"),
  );
  check(
    "MOBI 给出转换建议",
    failText.includes("旧电子书.mobi") && failText.includes("EPUB"),
  );
  check(
    "重复文件提示已在库里，没有重复导入",
    failText.includes("已经在库里") &&
      (await page.locator('[data-testid^="ref-ref-"]').count()) === 5,
  );

  // ── 检索 ────────────────────────────────────────────────
  await page.fill('[data-testid="ref-search"]', "暮色像一层薄薄的灰");
  await page.press('[data-testid="ref-search"]', "Enter");
  await page.waitForSelector('[data-testid="ref-hits"] li button');
  const hitCount = await page
    .locator('[data-testid="ref-hits"] li button')
    .count();
  check("全文检索跨多本资料找到命中", hitCount >= 10, `${hitCount} 条`);
  await page.locator('[data-testid="ref-hits"] li button').first().click();
  await page.waitForSelector('[data-testid="ref-text"] mark');
  check(
    "点击命中跳到章节并高亮检索词",
    (await page
      .locator('[data-testid="ref-text"] mark')
      .first()
      .textContent()) === "暮色像一层薄薄的灰",
  );
  await page.fill('[data-testid="ref-search"]', "绝对不存在的词语");
  await page.press('[data-testid="ref-search"]', "Enter");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="ref-hits"]')
        ?.textContent?.includes("没有找到"),
    null,
    { timeout: 8000 },
  );
  check("没有命中时明确说没有找到", true);
  await page.fill('[data-testid="ref-search"]', "");
  await page.press('[data-testid="ref-search"]', "Enter");

  // ── 选段：提问 ───────────────────────────────────────────
  await openByTitle("长安夜");
  const select = (from, length) =>
    page.evaluate(
      ({ from, length }) => {
        const container = document.querySelector('[data-testid="ref-text"]');
        const paragraph = container.querySelector("p");
        const node = paragraph.firstChild;
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, from + length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return range.toString();
      },
      { from, length },
    );
  const picked = await select(0, 24);
  await page.waitForSelector('[data-testid="ref-actions"]');
  check(
    "选中文字后出现操作条并显示字数",
    (
      (await page.locator('[data-testid="ref-actions"]').textContent()) ?? ""
    ).includes("已选 24 字"),
  );
  await page.click('[data-testid="ref-ask"]');
  await page.waitForSelector('[data-testid="composer-input"]');
  const composer = await page.inputValue('[data-testid="composer-input"]');
  check(
    "“提问”把引文和出处带进输入框并切回工作台",
    composer.includes(`> ${picked}`) &&
      composer.includes("——《长安夜》第一章 夜巡"),
    composer.slice(0, 80),
  );
  await page.fill('[data-testid="composer-input"]', "");

  // ── 选段：文风示范 ───────────────────────────────────────
  await openRefs();
  await openByTitle("长安夜");
  const stylePath = path.join(folder, ".wordhub", "bible", "style-samples.md");
  const tooShort = await select(0, 5);
  await page.click('[data-testid="ref-sample"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="ref-message"]')
        ?.textContent?.includes("太短"),
    null,
    { timeout: 8000 },
  );
  check(
    "太短的选段被拒绝并说明原因",
    (await message()).includes("至少 20 字") && !fs.existsSync(stylePath),
    tooShort,
  );
  const sampleText = await select(0, 40);
  await page.click('[data-testid="ref-sample"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="ref-message"]')
        ?.textContent?.includes("已加入文风示范"),
    null,
    { timeout: 8000 },
  );
  const styleFile = fs.existsSync(stylePath)
    ? fs.readFileSync(stylePath, "utf8")
    : "";
  check(
    "加入文风示范：写入 .wordhub/bible/style-samples.md，含引文、出处与“不得照抄”说明",
    styleFile.includes(`> ${sampleText}`) &&
      styleFile.includes("《长安夜》第一章 夜巡") &&
      styleFile.includes("不得照抄"),
  );
  const anchorLine = /来源：(ref-[0-9a-f]{12})\/(\d{4})\/(\d+)-(\d+)/u.exec(
    styleFile,
  );
  if (anchorLine) {
    const chapterText = fs.readFileSync(
      path.join(
        folder,
        ".wordhub",
        "references",
        anchorLine[1],
        "text",
        `${anchorLine[2]}.txt`,
      ),
      "utf8",
    );
    check(
      "文件里的锚点能回查到参考库原文，逐字一致",
      chapterText.slice(Number(anchorLine[3]), Number(anchorLine[4])) ===
        sampleText,
    );
  } else
    check("文件里的锚点能回查到参考库原文，逐字一致", false, "没有找到来源行");
  await page.click('[data-testid="ref-samples-toggle"]');
  check(
    "文风示范面板显示 1/5 与内容",
    (
      (await page
        .locator('[data-testid="ref-samples-toggle"]')
        .textContent()) ?? ""
    ).includes("1/5") &&
      (
        (await page.locator('[data-testid="ref-samples"]').textContent()) ?? ""
      ).includes(sampleText),
  );

  // 上限与重复
  await select(0, 40);
  await page.click('[data-testid="ref-sample"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="ref-message"]')
        ?.textContent?.includes("已经在文风示范里"),
    null,
    { timeout: 8000 },
  );
  check("重复选段被拒绝", true);
  for (let i = 1; i < 5; i += 1) {
    await select(i * 3, 40);
    await page.click('[data-testid="ref-sample"]');
    await page.waitForFunction(
      (n) =>
        document
          .querySelector('[data-testid="ref-samples-toggle"]')
          ?.textContent?.includes(`${n}/5`),
      i + 1,
      { timeout: 8000 },
    );
  }
  await select(10, 40);
  await page.click('[data-testid="ref-sample"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="ref-message"]')
        ?.textContent?.includes("最多保留 5 段"),
    null,
    { timeout: 8000 },
  );
  check("第 6 段被拒绝（上限 5 段）", true);
  await page.locator('[aria-label^="移除第 1 段示范"]').click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="ref-samples-toggle"]')
        ?.textContent?.includes("4/5"),
    null,
    { timeout: 8000 },
  );
  check(
    "移除一段后回到 4/5，被移除的那段也从文件里消失",
    !fs.readFileSync(stylePath, "utf8").includes(`> ${sampleText}`),
  );

  // ── 版面 ────────────────────────────────────────────────
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(906, 760),
  );
  await sleep(500);
  await select(0, 30);
  const layout = await page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      viewport: { w: innerWidth, h: innerHeight },
      side: box(".refs-side"),
      reader: box(".refs-reader"),
      actions: box('[data-testid="ref-actions"]'),
      importBtn: box('[data-testid="ref-import"]'),
      text: box('[data-testid="ref-text"]'),
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  check(
    "窄窗口没有横向溢出",
    !layout.overflowX,
    JSON.stringify(layout.viewport),
  );
  check(
    "导入按钮保持单行（图标与文字同行）",
    Boolean(layout.importBtn) &&
      layout.importBtn.h <= 34 &&
      layout.importBtn.w >= 60,
    JSON.stringify(layout.importBtn),
  );
  check(
    "选段操作条在阅读区内且不被压扁",
    Boolean(layout.actions) &&
      layout.actions.h <= 90 &&
      layout.actions.x >= layout.reader.x - 1,
    JSON.stringify(layout.actions),
  );
  check(
    "阅读文本区完整落在阅读栏内",
    Boolean(layout.text) &&
      layout.text.x >= layout.reader.x - 1 &&
      layout.text.x + layout.text.w <= layout.reader.x + layout.reader.w + 1,
    JSON.stringify({ text: layout.text, reader: layout.reader }),
  );

  // ── 删除与重启 ──────────────────────────────────────────
  const gbkCard = page.locator('[data-testid^="ref-ref-"]', {
    hasText: "旧书",
  });
  const gbkId =
    (await gbkCard.getAttribute("data-testid"))?.replace("ref-", "") ?? "";
  await page.locator('[aria-label="删除《旧书》"]').click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="ref-ref-"]').length === 4,
    null,
    { timeout: 8000 },
  );
  check(
    "删除后列表少一本，项目里的目录也被删掉",
    !fs.existsSync(path.join(folder, ".wordhub", "references", gbkId)),
    gbkId,
  );
  await closeApp(app);
  await launch();
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  await page.waitForSelector(
    '[data-testid="link-folder"], [data-testid="project-card"]',
    { timeout: 20000 },
  );
  if ((await page.locator('[data-testid="project-card"]').count()) === 0)
    await page
      .click('[data-testid="link-folder"]', { timeout: 5000 })
      .catch(() => undefined);
  await page.waitForSelector('[data-testid="project-card"]');
  await openRefs();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="ref-ref-"]').length === 4,
    null,
    { timeout: 15000 },
  );
  check("重启后参考库仍在（4 本）", true);
} catch (error) {
  const note = await message().catch(() => "");
  check(
    "脚本异常",
    false,
    `${String(error?.stack ?? error).slice(0, 600)} | 界面提示：${note}`,
  );
}
await closeApp(app);
const failed = findings.filter((item) => !item.passed);
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts", "references-e2e-result.json"),
  JSON.stringify({ findings }, null, 2),
);
console.log(`\n${findings.length - failed.length}/${findings.length} 通过`);
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
process.exit(failed.length ? 1 : 0);
