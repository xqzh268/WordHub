// 导出的端到端检查（mock 后台）：字体列表含预设与本机字体、全书 DOCX 用所选字体、
// 当前章 GB18030 TXT、取消保存不产生文件、非法字体名给出错误。保存对话框被替换为固定路径。
// 用法：npm run build:desktop && node scripts/export-e2e.mjs
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import iconv from "iconv-lite";
import JSZip from "jszip";
import { _electron } from "playwright";
import { closeApp } from "./lib/close-app.mjs";

const { ELECTRON_RUN_AS_NODE, DEEPSEEK_API_KEY, ...baseEnv } = process.env;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-export-e2e-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
const chapterDir = path.join(folder, "chapters");
const outDir = path.join(tmp, "输出");
fs.mkdirSync(chapterDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(chapterDir, "第一章.md"),
  "# 第一章 暮鼓\n\n暮鼓三百声，长安闭坊。\n",
);
fs.writeFileSync(
  path.join(chapterDir, "第二章.md"),
  "# 第二章 残月\n\n残月悬在天边。\n",
);
fs.writeFileSync(
  path.join(chapterDir, "第十章.md"),
  "# 第十章 归来\n\n他终于回到崇仁坊。\n",
);

const findings = [];
const check = (name, passed, detail = "") => {
  findings.push({ name, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}`,
  );
  return passed;
};
const textOf = (xml) =>
  [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/gu)].map((m) => m[1]).join("");

let app;
try {
  app = await _electron.launch({
    executablePath: electronBinary,
    args: [
      path.join(root, "out", "main", "index.js"),
      `--user-data-dir=${userData}`,
    ],
    cwd: root,
    env: { ...baseEnv, WORDHUB_MOCK: "1", WORDHUB_WORKSPACE_ROOT: root },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".app");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="worker-status"]')
        ?.textContent?.includes("待命"),
    null,
    { timeout: 20000 },
  );
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
    });
  }, folder);
  // 保存对话框：按调用顺序依次返回下面的结果
  const answers = [
    { canceled: true },
    { canceled: false, filePath: path.join(outDir, "全书.docx") },
    { canceled: false, filePath: path.join(outDir, "第一章.txt") },
    { canceled: false, filePath: path.join(outDir, "不该存在.docx") },
  ];
  await app.evaluate(({ dialog }, list) => {
    let call = 0;
    dialog.showSaveDialog = async () => list[Math.min(call++, list.length - 1)];
  }, answers);

  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]');
  await page.waitForSelector('[data-testid="chapter-select"]', {
    timeout: 8000,
  });
  await page.selectOption('[data-testid="chapter-select"]', {
    label: "第一章",
  });

  await page.click('[data-testid="export-open"]');
  await page.waitForSelector('[data-testid="export-panel"]');
  // 面板完整落在窗口内
  const box = await page.locator('[data-testid="export-panel"]').boundingBox();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  check(
    "导出面板完整显示在窗口内",
    Boolean(box) &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= viewport.width + 1 &&
      box.y + box.height <= viewport.height + 1,
    JSON.stringify(box),
  );

  // 面板没有被纸面区域裁掉（窄窗口下尤其要检查）
  const paneBox = await page.locator(".paper-pane").boundingBox();
  check(
    "导出面板完整落在纸面区域内，没有被裁切",
    Boolean(box) &&
      Boolean(paneBox) &&
      box.x >= paneBox.x - 0.5 &&
      box.x + box.width <= paneBox.x + paneBox.width + 0.5,
    `面板 ${JSON.stringify(box)} / 区域 ${JSON.stringify(paneBox)}`,
  );
  // 面板不被纸面遮挡：中心点命中的元素在面板内；触发按钮图标与文字同一行
  const onTop = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="export-panel"]');
    const rect = panel.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + 24,
    );
    return Boolean(hit?.closest('[data-testid="export-panel"]'));
  });
  check("导出面板在纸面之上，不被遮挡", onTop);
  const trigger = await page
    .locator('[data-testid="export-open"]')
    .boundingBox();
  check(
    "导出按钮图标与文字在同一行（高度不超过 34）",
    Boolean(trigger) && trigger.height <= 34 && trigger.width >= 56,
    JSON.stringify(trigger),
  );
  const finalizeBox = await page
    .locator('[data-testid="finalize"]')
    .boundingBox();
  check(
    "定稿按钮保持文字宽度，未被压成方块",
    Boolean(finalizeBox) && finalizeBox.width >= 44,
    JSON.stringify(finalizeBox),
  );
  const runBox = await page.locator('[data-testid="export-run"]').boundingBox();
  check(
    "面板里的主按钮没有被压窄",
    Boolean(runBox) && runBox.width >= 120 && runBox.height <= 34,
    JSON.stringify(runBox),
  );

  // ── 字体列表 ──────────────────────────────────────────────
  await page.waitForFunction(
    () => document.querySelectorAll("#export-fonts option").length > 5,
    null,
    { timeout: 20000 },
  );
  const fonts = await page.$$eval("#export-fonts option", (items) =>
    items.map((item) => item.value),
  );
  check(
    "字体候选含预设（宋体、楷体）和本机已安装字体",
    fonts.includes("宋体") && fonts.includes("楷体") && fonts.length > 5,
    `${fonts.length} 个`,
  );
  const defaults = [
    await page.inputValue('input[aria-label="正文字体"]'),
    await page.inputValue('input[aria-label="标题字体"]'),
  ];
  check(
    "默认正文宋体、标题楷体",
    defaults[0] === "宋体" && defaults[1] === "楷体",
    defaults.join("/"),
  );

  // ── 取消保存：不产生文件、不报错 ───────────────────────────
  await page.selectOption('select[aria-label="导出范围"]', "book");
  await page.click('[data-testid="export-run"]');
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-testid="export-run"]')
        ?.textContent?.includes("导出中"),
    null,
    { timeout: 10000 },
  );
  check(
    "取消保存对话框：没有生成文件，也没有提示",
    fs.readdirSync(outDir).length === 0 &&
      (await page.locator('[data-testid="export-message"]').count()) === 0,
  );

  // ── 全书 DOCX，用本机已安装的字体 ──────────────────────────
  const installedPick =
    ["微软雅黑", "仿宋", "黑体"].find((name) => fonts.includes(name)) ?? "宋体";
  await page.fill('input[aria-label="正文字体"]', installedPick);
  await page.click('[data-testid="export-run"]');
  const docxPath = path.join(outDir, "全书.docx");
  await page
    .waitForSelector('[data-testid="export-message"].ok', { timeout: 15000 })
    .catch(() => undefined);
  check("全书 DOCX 已写出", fs.existsSync(docxPath));
  if (fs.existsSync(docxPath)) {
    const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    check(
      "DOCX 使用所选的正文字体和默认楷体标题",
      xml.includes(`w:eastAsia="${installedPick}"`) &&
        xml.includes('w:eastAsia="楷体"'),
      installedPick,
    );
    const text = textOf(xml);
    check(
      "全书按章号顺序（第十章在第二章之后）",
      text.indexOf("第一章 暮鼓") < text.indexOf("第二章 残月") &&
        text.indexOf("第二章 残月") < text.indexOf("第十章 归来"),
    );
  }
  check(
    "界面显示导出结果",
    (
      (await page
        .locator('[data-testid="export-message"]')
        .textContent()
        .catch(() => "")) ?? ""
    ).includes("已导出 3 章"),
  );

  // ── 当前章 GB18030 TXT ──────────────────────────────────────
  await page.selectOption('select[aria-label="导出范围"]', "chapter");
  await page.selectOption('select[aria-label="导出格式"]', "txt-gb18030");
  await page.click('[data-testid="export-run"]');
  const txtPath = path.join(outDir, "第一章.txt");
  const end = Date.now() + 15000;
  while (!fs.existsSync(txtPath) && Date.now() < end)
    await new Promise((resolve) => setTimeout(resolve, 200));
  const bytes = fs.existsSync(txtPath)
    ? fs.readFileSync(txtPath)
    : Buffer.alloc(0);
  const decoded = iconv.decode(bytes, "gb18030");
  check(
    "当前章 GB18030 文本：按该编码解码得到正文，且不是 UTF-8",
    decoded.includes("暮鼓三百声") &&
      decoded.includes("第一章 暮鼓") &&
      !bytes.toString("utf8").includes("暮鼓三百声") &&
      !decoded.includes("残月"),
  );

  // ── 非法字体名：给出错误，不写文件 ─────────────────────────
  await page.selectOption('select[aria-label="导出格式"]', "docx");
  await page.fill('input[aria-label="正文字体"]', '宋体"><w:evil/>');
  await page.click('[data-testid="export-run"]');
  await page.waitForSelector('[data-testid="export-message"].bad', {
    timeout: 10000,
  });
  check(
    "非法字体名：显示错误且没有生成文件",
    (
      (await page.locator('[data-testid="export-message"]').textContent()) ?? ""
    ).includes("字体名无效") &&
      !fs.existsSync(path.join(outDir, "不该存在.docx")),
  );
} catch (error) {
  check("脚本异常", false, String(error?.stack ?? error).slice(0, 600));
}
await closeApp(app);
const failed = findings.filter((item) => !item.passed);
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts", "export-e2e-result.json"),
  JSON.stringify({ findings }, null, 2),
);
console.log(`\n${findings.length - failed.length}/${findings.length} 通过`);
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
process.exit(failed.length ? 1 : 0);
