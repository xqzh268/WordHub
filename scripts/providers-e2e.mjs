// Provider设置的Electron端到端：预设、自定义（价格/编辑）、模型分配（含史官）、一键切换、筛选、重启后保留。
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron } from "playwright";
import http from "node:http";
import { closeApp } from "./lib/close-app.mjs";

const root = path.resolve(import.meta.dirname, "..");
const electronBinary = createRequire(import.meta.url)("electron");
const userData = fs.mkdtempSync(
  path.join(os.tmpdir(), "wordhub-providers-ud-"),
);
const storage = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-providers-st-"));
const env = { ...process.env, WORDHUB_MOCK: "1", WORDHUB_WORKSPACE_ROOT: root };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DEEPSEEK_API_KEY;
delete env.OPENAI_API_KEY;
const problems = [];
const check = (name, ok, detail) => {
  if (!ok) problems.push(detail ? `${name}: ${detail}` : name);
};

async function launch() {
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: [path.join(root, "out/main/index.js"), `--user-data-dir=${userData}`],
    cwd: root,
    env: { ...env, WORDHUB_STORAGE_ROOT: storage },
  });
  const page = await app.firstWindow();
  await page.click('[data-testid="rail-settings"]');
  await page.waitForSelector('[data-testid="provider-deepseek"]');
  return { app, page };
}

// 模拟服务商的 /models 接口，验证“从接口获取模型”。
let seenAuth = "";
const modelServer = http.createServer((req, res) => {
  if (req.url === "/v1/models") {
    seenAuth = req.headers.authorization ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: [
          { id: "gpt-4o-mini" },
          {
            id: "vendor/think-pro",
            context_length: 200000,
            pricing: { prompt: "0.000002", completion: "0.000008" },
            supported_parameters: ["reasoning"],
          },
          { id: "mystery-model" },
        ],
      }),
    );
    return;
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
const modelBase = `http://127.0.0.1:${modelServer.address().port}/v1`;

let { app, page } = await launch();
try {
  check(
    "默认DeepSeek未配置密钥",
    (await page.textContent('[data-testid="provider-deepseek"]')).includes(
      "尚未配置密钥",
    ),
  );
  // 添加预设
  const options = await page.$$eval(
    'select[aria-label="选择预设服务商"] option',
    (o) => o.map((x) => x.value),
  );
  check(
    "预设含openai/anthropic/openrouter",
    ["openai", "anthropic", "openrouter"].every((id) => options.includes(id)),
    options.join(","),
  );
  await page.selectOption('select[aria-label="选择预设服务商"]', "openai");
  await page.click('button:has-text("添加")');
  await page.waitForSelector('[data-testid="provider-openai"]');
  // 自定义
  await page.click('button:has-text("自定义…")');
  await page.fill('input[aria-label="Provider ID"]', "my-gateway");
  await page.fill('input[aria-label="Provider 名称"]', "我的网关");
  await page.fill('input[aria-label="Base URL"]', "https://llm.example.com/v1");
  await page.fill('input[aria-label="模型ID-0"]', "writer-1");
  await page.fill('input[aria-label="显示名-0"]', "写作一号");
  await page.fill('input[aria-label="输入价格-0"]', "1");
  await page.fill('input[aria-label="输出价格-0"]', "2");
  await page.selectOption('select[aria-label="思考档位-0"]', "auto");
  await page.click('button:has-text("添加模型行")');
  await page.fill('input[aria-label="模型ID-1"]', "plain");
  await page.click('button:has-text("添加自定义服务商")');
  await page.waitForSelector('[data-testid="provider-my-gateway"]');
  const unpricedText = await page
    .textContent('[data-testid="unpriced-my-gateway"]')
    .catch(() => "");
  check(
    "没填价格的模型被标为价格未知，填了的不标",
    unpricedText.includes("plain") && !unpricedText.includes("writer-1"),
    unpricedText,
  );
  // 编辑：给 plain 填价格后不再提示
  await page.click('button[aria-label="编辑我的网关"]');
  check(
    "编辑时ID不可改",
    await page.locator('input[aria-label="Provider ID"]').isDisabled(),
  );
  await page.fill('input[aria-label="输入价格-1"]', "0.5");
  await page.fill('input[aria-label="输出价格-1"]', "1.5");
  await page.click('button:has-text("保存修改")');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="unpriced-my-gateway"]'),
    null,
    { timeout: 5000 },
  );
  check("编辑后价格未知提示消失", true);
  // 非法输入给出错误
  await page.click('button:has-text("自定义…")');
  await page.fill('input[aria-label="Provider ID"]', "Bad ID");
  await page.fill('input[aria-label="Base URL"]', "https://x.example.com");
  await page.fill('input[aria-label="模型ID-0"]', "m1");
  await page.click('button:has-text("添加自定义服务商")');
  await page.waitForSelector('[role="alert"]');
  check(
    "非法ID被拒绝",
    (await page.textContent('[role="alert"]')).includes("Provider ID"),
  );
  // 保存密钥
  await page.fill('input[aria-label="我的网关 API key"]', "test-key-123");
  await page.click(
    '[data-testid="provider-my-gateway"] button:has-text("保存")',
  );
  await page.waitForSelector(
    '[data-testid="provider-my-gateway"] :text("密钥已加密保存")',
  );
  // 模型分配：观察者隐藏，下拉含新Provider分组
  const names = await page.$$eval(".model-table .mt-name", (e) =>
    e.map((x) => x.textContent),
  );
  check(
    "模型分配含史官（原观察者）",
    names.includes("史官") && !names.includes("观察者") && names.length >= 5,
    names.join(","),
  );
  const groups = await page
    .$$eval('select[aria-label$="模型"] >> nth=0 >> optgroup', (g) =>
      g.map((x) => x.label),
    )
    .catch(() => []);
  const writerSelect = page.locator('select[aria-label="写手模型"]');
  const labels = await writerSelect
    .locator("optgroup")
    .evaluateAll((g) => g.map((x) => x.label));
  check(
    "模型下拉按Provider分组",
    labels.includes("DeepSeek") &&
      labels.includes("我的网关") &&
      labels.length >= 3,
    labels.join(","),
  );
  // 给写手选自定义模型
  await writerSelect.selectOption("my-gateway/writer-1");
  await page.waitForFunction(
    () =>
      document.querySelector('select[aria-label="写手模型"]')?.value ===
      "my-gateway/writer-1",
  );
  void groups;
  // 一键切换全部角色，再把写手改回自定义模型
  await page
    .locator('select[aria-label="全部角色使用同一模型"]')
    .selectOption("my-gateway/plain");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".model-table li")].every(
        (li) => li.querySelector("select")?.value === "my-gateway/plain",
      ),
    null,
    { timeout: 5000 },
  );
  check("全部角色一键切到同一模型", true);
  await writerSelect.selectOption("my-gateway/writer-1");
  // 筛选：只保留匹配的模型和当前所选
  await page.fill('input[aria-label="筛选模型"]', "写作");
  const filtered = await page
    .locator(
      'select[aria-label="规划模型"] option, select[aria-label="纲领模型"] option',
    )
    .allTextContents();
  check(
    "筛选只保留匹配的模型",
    filtered.includes("写作一号") && !filtered.includes("DeepSeek V4 Pro"),
    filtered.join(","),
  );
  await page.fill('input[aria-label="筛选模型"]', "");
  // 侧栏：列出史官；点模型可就地切换，设置页同步
  await page.click('[data-testid="rail-workspace"]');
  await page.waitForSelector('[data-testid="agent-writer"]', { timeout: 5000 });
  check(
    "侧栏 Agent 列表包含史官",
    (await page.locator('[data-testid="agent-observer"]').count()) === 1,
  );
  await page.click('[data-testid="agent-model-writer"]');
  await page
    .locator('[data-testid="agent-picker"] select')
    .first()
    .selectOption("my-gateway/plain");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="agent-model-writer"]')
        ?.textContent?.includes("plain"),
    null,
    { timeout: 5000 },
  );
  await page.click('[data-testid="rail-settings"]');
  await page.waitForFunction(
    () =>
      document.querySelector('select[aria-label="写手模型"]')?.value ===
      "my-gateway/plain",
    null,
    { timeout: 5000 },
  );
  check("侧栏切换模型后设置页同步", true);
  await page
    .locator('select[aria-label="写手模型"]')
    .selectOption("my-gateway/writer-1");
  await page.click('[data-testid="rail-workspace"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="agent-model-writer"]')
        ?.textContent?.includes("writer-1"),
    null,
    { timeout: 5000 },
  );
  check("设置页切换模型后侧栏同步", true);
  await page.click('[data-testid="rail-settings"]');
} catch (error) {
  problems.push(String(error?.stack ?? error));
}
await closeApp(app);

// 重启后配置保留
({ app, page } = await launch());
try {
  check(
    "重启后自定义Provider仍在",
    (await page.locator('[data-testid="provider-my-gateway"]').count()) === 1,
  );
  check(
    "重启后密钥仍在",
    (await page.textContent('[data-testid="provider-my-gateway"]')).includes(
      "密钥已加密保存",
    ),
  );
  const value = await page
    .locator('select[aria-label="写手模型"]')
    .inputValue();
  check("重启后写手模型保留", value === "my-gateway/writer-1", value);
  // 写手仍在用时不能停用，并给出原因
  await page.click('input[aria-label="启用我的网关"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="provider-my-gateway"]')
        ?.textContent?.includes("正在使用该服务商"),
    null,
    { timeout: 5000 },
  );
  check(
    "在用的服务商不能停用",
    await page.isChecked('input[aria-label="启用我的网关"]'),
  );
  // 从接口获取模型
  await page.click('button:has-text("自定义…")');
  await page.fill('input[aria-label="Provider ID"]', "local-gw");
  await page.fill('input[aria-label="Provider 名称"]', "本地网关");
  await page.fill('input[aria-label="Base URL"]', modelBase);
  await page.fill('input[aria-label="自定义服务商API key"]', "sk-local-test");
  await page.click('button:has-text("从接口获取模型")');
  await page.waitForSelector('[data-testid="remote-models"]');
  check(
    "获取模型时带上表单里的密钥",
    seenAuth === "Bearer sk-local-test",
    seenAuth,
  );
  const listed = await page
    .locator('[data-testid="remote-models"] .mono')
    .allTextContents();
  check("接口模型全部列出", listed.length === 3, listed.join(","));
  await page.click('button:has-text("添加选中的 3 个模型")');
  const ids = await Promise.all(
    [0, 1, 2].map((i) =>
      page.locator(`input[aria-label="模型ID-${i}"]`).inputValue(),
    ),
  );
  check(
    "选中的模型填入表单，替换空白行",
    ids.join(",") === "gpt-4o-mini,mystery-model,vendor/think-pro",
    ids.join(","),
  );
  const thinkRow = ids.indexOf("vendor/think-pro");
  check(
    "接口声明思考的模型自动设为支持思考",
    (await page
      .locator(`select[aria-label="思考档位-${thinkRow}"]`)
      .inputValue()) !== "none",
  );
  check(
    "接口给出的上下文长度被回填",
    (await page
      .locator(`input[aria-label="上下文长度-${thinkRow}"]`)
      .inputValue()) === "200000",
  );
  await page.selectOption(`select[aria-label="思考档位-${thinkRow}"]`, "max");
  await page.click('button:has-text("添加自定义服务商")');
  await page.waitForSelector('[data-testid="provider-local-gw"]');
  check(
    "表单里的密钥随服务商一起保存",
    (await page.textContent('[data-testid="provider-local-gw"]')).includes(
      "密钥已加密保存",
    ),
  );
  check(
    "价格未知只标没匹配上的模型",
    (
      await page
        .textContent('[data-testid="unpriced-local-gw"]')
        .catch(() => "")
    ).includes("mystery-model") &&
      !(await page.textContent('[data-testid="unpriced-local-gw"]')).includes(
        "gpt-4o-mini",
      ),
  );
  // 自定义思考最高档 max 在模型分配里可选
  await page
    .locator('select[aria-label="写手模型"]')
    .selectOption("local-gw/vendor/think-pro");
  await page.waitForFunction(
    () =>
      [
        ...(document.querySelector('select[aria-label="写手思考强度"]')
          ?.options ?? []),
      ].some((o) => o.value === "max"),
    null,
    { timeout: 5000 },
  );
  check("最高档 max 出现在思考强度里", true);
  await page
    .locator('select[aria-label="写手模型"]')
    .selectOption("my-gateway/writer-1");
  // 停用无人使用的服务商：模型从选择列表消失；再启用恢复
  await page.click('input[aria-label="启用本地网关"]');
  await page.waitForFunction(
    () =>
      ![
        ...(document.querySelector('select[aria-label="写手模型"]')?.options ??
          []),
      ].some((o) => o.value.startsWith("local-gw/")),
    null,
    { timeout: 5000 },
  );
  check("停用后模型不再可选", true);
  check(
    "停用状态显示在服务商行",
    (await page.textContent('[data-testid="provider-local-gw"]')).includes(
      "已停用",
    ),
  );
  await page.click('input[aria-label="启用本地网关"]');
  await page.waitForFunction(
    () =>
      [
        ...(document.querySelector('select[aria-label="写手模型"]')?.options ??
          []),
      ].some((o) => o.value.startsWith("local-gw/")),
    null,
    { timeout: 5000 },
  );
  check("重新启用后模型恢复", true);
  // 移除需要二次确认；取消后仍在
  await page.click(
    '[data-testid="provider-my-gateway"] button:has-text("移除")',
  );
  await page.click(
    '[data-testid="provider-my-gateway"] button:has-text("取消")',
  );
  check(
    "取消移除后服务商仍在",
    (await page.locator('[data-testid="provider-my-gateway"]').count()) === 1,
  );
  // 移除自定义Provider后写手回到默认
  await page.click(
    '[data-testid="provider-my-gateway"] button:has-text("移除")',
  );
  await page.click(
    '[data-testid="provider-my-gateway"] button:has-text("确认移除")',
  );
  await page.waitForSelector('[data-testid="provider-my-gateway"]', {
    state: "detached",
  });
  await page
    .waitForFunction(
      () =>
        !document
          .querySelector('select[aria-label="写手模型"]')
          ?.value.startsWith("my-gateway"),
      null,
      { timeout: 5000 },
    )
    .catch(() => undefined);
  const after = await page
    .locator('select[aria-label="写手模型"]')
    .inputValue();
  check("移除后写手回到默认模型", after.startsWith("deepseek/"), after);
} catch (error) {
  problems.push(String(error?.stack ?? error));
}
await closeApp(app);
modelServer.close();
console.log(JSON.stringify({ ok: problems.length === 0, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
