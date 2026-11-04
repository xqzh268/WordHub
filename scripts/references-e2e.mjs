// 参考库·书架端到端（mock 后台，Electron）：
// 导入 TXT(UTF-8/GB18030)、EPUB、DOCX、中文 PDF（由 Chromium 打印生成），以及会被拒绝的 DRM EPUB / 无文字层 PDF / MOBI；
// 阅读、全文检索并跳到命中处、选段 → 提问 / 作为文风示范，文风示范上限；书架：封面、网格/列表、筛选与排序、收藏、标签、集合（多归属）、
// 阅读状态与进度、信息编辑与校验、重复提示、高亮与批注（重启后仍在）；删除、重启后仍在，以及版面断言。
// 用法：npm run build:desktop && node scripts/references-e2e.mjs
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import iconv from "iconv-lite";
import zlib from "node:zlib";
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

// 一张纯色 PNG 当 EPUB 封面
function solidPng(w, h) {
  const crcOf = (buf) => {
    let crc = 0xffffffff;
    for (const b of buf) {
      let c = (crc ^ b) & 0xff;
      for (let k = 0; k < 8; k += 1)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crcOf(body));
    return Buffer.concat([len, body, crc]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = 40;
      raw[o + 1] = 90 + (x % 100);
      raw[o + 2] = 140;
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>电子书样本</dc:title><dc:creator>某作者</dc:creator></metadata><manifest><item id="c0" href="c0.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="cv" href="cover.png" media-type="image/png" properties="cover-image"/></manifest><spine><itemref idref="c0"/><itemref idref="c1"/></spine></package>',
  );
  zip.file(
    "OEBPS/c0.xhtml",
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>序幕</h1><p>${para("序幕")}</p></body></html>`,
  );
  zip.file(
    "OEBPS/c1.xhtml",
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>终幕</h1><p>${para("终幕")}</p></body></html>`,
  );
  zip.file("OEBPS/cover.png", solidPng(200, 300));
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
    () => document.querySelectorAll('[data-testid^="book-ref-"]').length >= 5,
    null,
    { timeout: 60000 },
  );
  const cards = await page.$$eval('[data-testid^="book-ref-"]', (items) =>
    items.map((item) => item.textContent ?? ""),
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
    if (await page.locator('[data-testid="reader-back"]').count())
      await page.click('[data-testid="reader-back"]');
    await page.click(`[aria-label="打开《${title}》"]`);
    // 等阅读栏标题换成这本书（只等“有段落”会读到上一本书还没被替换掉的旧文字）
    await page.waitForFunction(
      (name) =>
        document
          .querySelector(".refs-reader-head small")
          ?.textContent?.includes(`《${name}》`) &&
        document.querySelector('[data-testid="ref-text"] p') !== null,
      title,
      { timeout: 15000 },
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
  await page.click('[data-testid="reader-back"]');
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
      (await page.locator('[data-testid^="book-ref-"]').count()) === 5,
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
  // 在第一段里按“字符偏移”选中文字（段落被拆成多个 span，要沿文本节点走）
  const select = (from, length, row = 0) =>
    page.evaluate(
      ({ from, length, row }) => {
        const container = document.querySelector('[data-testid="ref-text"]');
        const paragraph = [...container.querySelectorAll("p")].filter(
          (item) => (item.textContent ?? "").length >= 30,
        )[row];
        const walker = document.createTreeWalker(
          paragraph,
          NodeFilter.SHOW_TEXT,
        );
        const locate = (target) => {
          let seen = 0;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const len = node.textContent.length;
            if (target <= seen + len) return [node, target - seen];
            seen += len;
          }
          return null;
        };
        walker.currentNode = paragraph;
        const a = locate(from);
        walker.currentNode = paragraph;
        const b = locate(from + length);
        const range = document.createRange();
        range.setStart(a[0], a[1]);
        range.setEnd(b[0], b[1]);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return range.toString();
      },
      { from, length, row },
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
  // 文风示范面板在书架侧栏：回书架看 1/5 与内容，再回到阅读器继续选段
  await page.click('[data-testid="reader-back"]');
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
  await openByTitle("长安夜");

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
          .querySelector('[data-testid="ref-message"]')
          ?.textContent?.includes(`现有 ${n} 段`),
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
  await page.click('[data-testid="reader-back"]');
  if (!(await page.locator('[data-testid="ref-samples"]').count()))
    await page.click('[data-testid="ref-samples-toggle"]');
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

  // ── 书架：封面、筛选排序、收藏、标签、集合、状态、信息、批注 ──────
  await page.click('[data-testid="reader-back"]').catch(() => undefined);
  await page.waitForSelector('[data-testid="shelf-books"]');
  const idOf = async (title) =>
    (
      (await page
        .locator('[data-testid^="book-ref-"]', { hasText: title })
        .first()
        .getAttribute("data-testid")) ?? ""
    ).replace("book-", "");
  const refDir = (id) => path.join(folder, ".wordhub", "references", id);
  const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const changanId = await idOf("长安夜");
  const epubId = await idOf("电子书样本");
  const docxId = await idOf("文档样本");

  check(
    "EPUB 自带封面：存成 cover 文件并显示为图片",
    fs.readdirSync(refDir(epubId)).some((n) => n.startsWith("cover.")) &&
      (await page.locator(`[data-testid="cover-${epubId}"] img`).count()) === 1,
  );
  check(
    "没有封面的书显示生成的文字封面（含书名与格式）",
    (await page.locator(`[data-testid="cover-${changanId}"] img`).count()) ===
      0 &&
      (
        (await page
          .locator(`[data-testid="cover-${changanId}"]`)
          .textContent()) ?? ""
      ).includes("长安夜"),
  );

  // 网格 / 列表
  await page.click('[data-testid="view-list"]');
  check(
    "切到列表视图",
    (await page.locator(".shelf-books.list").count()) === 1,
  );
  await page.click('[data-testid="view-grid"]');
  check(
    "切回网格视图",
    (await page.locator(".shelf-books.grid").count()) === 1,
  );

  // 收藏 + 筛选
  await page.click(`[data-testid="star-${changanId}"]`);
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-testid="star-${id}"]`)
        ?.getAttribute("aria-pressed") === "true",
    changanId,
    { timeout: 8000 },
  );
  check(
    "收藏写入 reference.json",
    readJson(path.join(refDir(changanId), "reference.json")).favorite === true,
  );
  await page.click('[data-testid="nav-favorite"]');
  check(
    "“收藏”分类只剩收藏的那本",
    (await page.locator('[data-testid^="book-ref-"]').count()) === 1,
  );
  await page.click('[data-testid="nav-all"]');

  // 阅读状态：打开过的书自动变“在读”
  check(
    "打开过的书自动标为“在读”",
    readJson(path.join(refDir(changanId), "reference.json")).status ===
      "reading",
  );
  await page.click(`[data-testid="menu-${docxId}"]`);
  await page
    .locator(`[data-testid="menu-panel-${docxId}"] [role="menuitemradio"]`, {
      hasText: "读完",
    })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="《文档样本》阅读进度"]')
        ?.getAttribute("aria-valuenow") === "100",
    null,
    { timeout: 8000 },
  );
  check("标为“读完”后进度条满格", true);
  await page.keyboard.press("Escape");
  await page.click('[data-testid="nav-status-finished"]');
  check(
    "“读完”分类里只有这一本",
    (await page.locator('[data-testid^="book-ref-"]').count()) === 1,
  );
  await page.click('[data-testid="nav-all"]');

  // 集合：新建两个，同一本书可同时属于两个
  const makeCollection = async (name) => {
    await page.click('[data-testid="collection-new"]');
    await page.fill('[data-testid="collection-name"]', name);
    await page.click('[data-testid="collection-ok"]');
    await page.waitForSelector(`[aria-label="删除集合“${name}”"]`);
  };
  await makeCollection("毕业论文");
  await makeCollection("小说素材");
  const collectionIds = await page.$$eval(
    '[data-testid^="nav-collection-"]',
    (items) =>
      items.map((item) =>
        item.getAttribute("data-testid").replace("nav-collection-", ""),
      ),
  );
  check("新建了两个集合", collectionIds.length === 2);
  for (const cid of collectionIds) {
    await page.click(`[data-testid="menu-${changanId}"]`);
    await page.click(`[data-testid="menu-collection-${cid}"]`);
    await page.keyboard.press("Escape");
    await sleep(300);
  }
  check(
    "同一本书可以同时在两个集合里（写入 reference.json 与 library.json）",
    readJson(path.join(refDir(changanId), "reference.json")).collectionIds
      .length === 2 &&
      JSON.stringify(
        readJson(path.join(folder, ".wordhub", "references", "library.json")),
      ).includes("小说素材"),
  );
  await page.click(`[data-testid="nav-collection-${collectionIds[0]}"]`);
  check(
    "点集合只显示其中的书",
    (await page.locator('[data-testid^="book-ref-"]').count()) === 1,
  );
  await page.click('[data-testid="nav-all"]');
  // 重命名
  await page.click('[aria-label="重命名集合“小说素材”"]');
  await page.fill('[data-testid="collection-name"]', "素材库");
  await page.click('[data-testid="collection-ok"]');
  await page.waitForSelector('[aria-label="删除集合“素材库”"]');
  check("集合可重命名", true);
  // 删除集合：书还在，只是不再属于它
  await page.click('[aria-label="删除集合“素材库”"]');
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="删除集合“素材库”"]'),
    null,
    { timeout: 8000 },
  );
  await sleep(300);
  check(
    "删除集合后书仍在，成员关系同步更新",
    (await page.locator('[data-testid^="book-ref-"]').count()) === 5 &&
      readJson(path.join(refDir(changanId), "reference.json")).collectionIds
        .length === 1,
  );

  // 信息编辑：校验、标签、年份
  await page.click(`[data-testid="menu-${epubId}"]`);
  await page
    .locator(`[data-testid="menu-panel-${epubId}"]`)
    .getByText("编辑信息")
    .click();
  await page.waitForSelector('[data-testid="book-info"]');
  await page.fill('[aria-label="DOI"]', "这不是DOI");
  await page.click('[data-testid="info-save"]');
  await page.waitForSelector('[data-testid="info-error"]');
  check(
    "DOI 格式不对时给出明确错误，不保存",
    (
      (await page.locator('[data-testid="info-error"]').textContent()) ?? ""
    ).trim().length > 0 &&
      readJson(path.join(refDir(epubId), "reference.json")).doi === undefined,
  );
  await page.fill('[aria-label="DOI"]', "10.1000/xyz123");
  await page.fill('[aria-label="年份"]', "2018");
  await page.selectOption('[aria-label="类型"]', "paper");
  await page.fill('[data-testid="tag-input"]', "文风参考");
  await page.press('[data-testid="tag-input"]', "Enter");
  await page.fill('[data-testid="tag-input"]', "AI");
  await page.press('[data-testid="tag-input"]', "Enter");
  await page.fill('[data-testid="tag-input"]', "ai");
  await page.press('[data-testid="tag-input"]', "Enter");
  check(
    "标签大小写重复只留一个",
    (await page.locator('[aria-label^="移除标签"]').count()) === 2,
  );
  await page.click('[data-testid="info-save"]');
  await sleep(800);
  const epubMeta = readJson(path.join(refDir(epubId), "reference.json"));
  check(
    "信息保存到 reference.json（DOI、年份、类型、标签）",
    epubMeta.doi === "10.1000/xyz123" &&
      epubMeta.year === 2018 &&
      epubMeta.kind === "paper" &&
      epubMeta.tags.length === 2,
    JSON.stringify(epubMeta).slice(0, 300),
  );
  await page.click('[data-testid="reader-back"]');
  await page.waitForSelector('[data-testid="nav-tag-文风参考"]');
  await page.click('[data-testid="nav-tag-文风参考"]');
  check(
    "按标签筛选",
    (await page.locator('[data-testid^="book-ref-"]').count()) === 1,
  );
  await page.click('[data-testid="nav-all"]');

  // 排序（年份降序：给文档样本也填个更近的年份）
  await page.click(`[data-testid="menu-${docxId}"]`);
  await page
    .locator(`[data-testid="menu-panel-${docxId}"]`)
    .getByText("编辑信息")
    .click();
  await page.waitForSelector('[data-testid="book-info"]');
  await page.fill('[aria-label="年份"]', "2022");
  await page.click('[data-testid="info-save"]');
  await sleep(800);
  await page.click('[data-testid="reader-back"]');
  await page.selectOption('[data-testid="shelf-sort"]', "year");
  const yearOrder = await page.$$eval(
    '[data-testid^="book-ref-"] .book-title',
    (nodes) => nodes.map((n) => n.textContent),
  );
  check(
    "按年份排序：最新的在前，没填年份的排最后",
    yearOrder[0] === "文档样本" && yearOrder[1] === "电子书样本",
    yearOrder.join(","),
  );
  await page.selectOption('[data-testid="shelf-sort"]', "recent");

  // 书架筛选框
  await page.fill('[data-testid="shelf-filter"]', "某作者");
  check(
    "筛选框按作者过滤",
    (await page.locator('[data-testid^="book-ref-"]').count()) === 1,
  );
  await page.fill('[data-testid="shelf-filter"]', "绝对没有的词");
  await page.waitForSelector('[data-testid="shelf-none"]');
  check("筛不到时给出提示而不是空白", true);
  await page.fill('[data-testid="shelf-filter"]', "");

  // 重复版本提示
  const dupFile = path.join(inbox, "长安夜（修订版）.txt");
  fs.writeFileSync(dupFile, `长安夜\n\n${novel("丁")}`, "utf8");
  await stubOpenDialog([[dupFile]]);
  await page.click('[data-testid="ref-import"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="ref-message"]')
        ?.textContent?.includes("可能是同一本书"),
    null,
    { timeout: 30000 },
  );
  check("书名作者相同的新导入给出“可能重复”提示", true);
  await page.click('[data-testid="nav-similar"]');
  check(
    "“可能重复”分类列出这一组（2 本）",
    (await page.locator('[data-testid^="book-ref-"]').count()) === 2,
  );
  const dupId = (
    await page
      .locator('[data-testid^="book-ref-"]')
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-testid")),
      )
  )
    .map((id) => id.replace("book-", ""))
    .find((id) => id !== changanId);
  await page.click(`[data-testid="menu-${dupId}"]`);
  await page
    .locator(`[data-testid="menu-panel-${dupId}"]`)
    .getByText("删除")
    .click();
  await page.click('[data-testid="nav-all"]');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="book-ref-"]').length === 5,
    null,
    { timeout: 8000 },
  );
  check("从菜单删除重复的那本", !fs.existsSync(refDir(dupId)));

  // 高亮与批注
  await openByTitle("长安夜");
  const hlText = await select(0, 24);
  await page.click('[data-testid="hl-green"]');
  await page.waitForSelector(".hl.green");
  await select(30, 24);
  await page.click('[data-testid="ref-note-toggle"]');
  await page.fill('[data-testid="note-input"]', "节奏值得学");
  await page.click('[data-testid="note-save"]');
  await page.click('[data-testid="panel-annotations-toggle"]');
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid="annotation-list"] li').length ===
      2,
    null,
    { timeout: 8000 },
  );
  check("批注面板列出 2 条（高亮 + 带笔记）", true);
  const saved = JSON.stringify(
    readJson(path.join(refDir(changanId), "annotations.json")),
  );
  check(
    "批注写入 annotations.json，引文由后台从原文切出（逐字一致）",
    saved.includes(hlText) && saved.includes("节奏值得学"),
  );
  await page
    .locator('[data-testid="annotation-list"] li')
    .nth(1)
    .locator('[aria-label="删除这条批注"]')
    .click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid="annotation-list"] li').length ===
      1,
    null,
    { timeout: 8000 },
  );
  check("删除一条批注后只剩 1 条", true);
  await page.click('[data-testid="reader-back"]');

  // ── 版面（窄窗口：书架与阅读器）──────────────────────────
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(906, 760),
  );
  await sleep(500);
  const boxes = () =>
    page.evaluate(() => {
      const box = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      return {
        viewport: { w: innerWidth, h: innerHeight },
        importBtn: box('[data-testid="ref-import"]'),
        sort: box('[data-testid="shelf-sort"]'),
        reader: box(".reader-main"),
        actions: box('[data-testid="ref-actions"]'),
        text: box('[data-testid="ref-text"]'),
        overflowX: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
  const shelfLayout = await boxes();
  check(
    "窄窗口：书架没有横向溢出",
    !shelfLayout.overflowX,
    JSON.stringify(shelfLayout.viewport),
  );
  check(
    "窄窗口：导入按钮单行且在窗口内",
    Boolean(shelfLayout.importBtn) &&
      shelfLayout.importBtn.h <= 34 &&
      shelfLayout.importBtn.x + shelfLayout.importBtn.w <=
        shelfLayout.viewport.w,
    JSON.stringify(shelfLayout.importBtn),
  );
  check(
    "窄窗口：排序框高度正常（文字没被裁切）",
    Boolean(shelfLayout.sort) &&
      shelfLayout.sort.h >= 28 &&
      shelfLayout.sort.h <= 40,
    JSON.stringify(shelfLayout.sort),
  );
  await openByTitle("长安夜");
  await select(20, 30);
  const layout = await boxes();
  check(
    "窄窗口：阅读器没有横向溢出",
    !layout.overflowX,
    JSON.stringify(layout.viewport),
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
  await page.click('[data-testid="reader-back"]');

  // ── 删除与重启 ──────────────────────────────────────────
  const gbkId = await idOf("旧书");
  await page.click(`[data-testid="menu-${gbkId}"]`);
  await page
    .locator(`[data-testid="menu-panel-${gbkId}"]`)
    .getByText("删除")
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="book-ref-"]').length === 4,
    null,
    { timeout: 8000 },
  );
  check(
    "删除后列表少一本，项目里的目录也被删掉",
    !fs.existsSync(refDir(gbkId)),
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
    () => document.querySelectorAll('[data-testid^="book-ref-"]').length === 4,
    null,
    { timeout: 15000 },
  );
  check("重启后参考库仍在（4 本）", true);
  check(
    "重启后收藏、集合、标签、封面都还在",
    (await page
      .locator(`[data-testid="star-${changanId}"]`)
      .getAttribute("aria-pressed")) === "true" &&
      (await page.locator('[data-testid^="nav-collection-"]').count()) === 1 &&
      (await page.locator('[data-testid="nav-tag-文风参考"]').count()) === 1 &&
      (await page.locator(`[data-testid="cover-${epubId}"] img`).count()) === 1,
  );
  await openByTitle("长安夜");
  await page.click('[data-testid="panel-annotations-toggle"]');
  await page.waitForSelector('[data-testid="annotation-list"] li');
  check(
    "重启后批注与高亮还在",
    (await page.locator('[data-testid="annotation-list"] li').count()) === 1 &&
      (await page.locator(".hl.green").count()) >= 1,
  );
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
