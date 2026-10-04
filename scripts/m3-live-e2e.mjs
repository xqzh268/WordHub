// M3 第5步：真实DeepSeek工作流回归。默认跳过，WORDHUB_REQUIRE_LIVE=1时缺密钥直接失败。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron } from "playwright";

const readWindowsEnvironmentKey = () => {
  if (process.platform !== "win32") return undefined;
  const command =
    "$p=[Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','Process');$u=[Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User');$m=[Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','Machine');if($p){$p}elseif($u){$u}else{$m}";
  for (const executable of ["powershell.exe", "pwsh.exe"]) {
    const result = spawnSync(
      executable,
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", windowsHide: true },
    );
    const value = result.stdout?.trim();
    if (result.status === 0 && value) return value;
  }
  return undefined;
};
const key =
  process.env.DEEPSEEK_API_KEY ??
  process.env.WORDHUB_DEEPSEEK_API_KEY ??
  readWindowsEnvironmentKey();
if (!key) {
  if (process.env.WORDHUB_REQUIRE_LIVE === "1") {
    console.error("失败：M3真实回归要求DEEPSEEK_API_KEY。");
    process.exit(2);
  }
  console.log("跳过：未设置DEEPSEEK_API_KEY（本地可选）。");
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wordhub-m3-live-"));
const userData = path.join(tmp, "appdata");
const folder = path.join(tmp, "写作", "长安夜");
fs.mkdirSync(path.join(folder, ".wordhub", "bible"), { recursive: true });
fs.mkdirSync(path.join(folder, "chapters"), { recursive: true });
fs.writeFileSync(
  path.join(folder, ".wordhub", "bible", "bible.md"),
  "裴照是左撇子，惯用横刀。评审必须检查左右手矛盾。",
  "utf8",
);
fs.writeFileSync(
  path.join(folder, "chapters", "第三章.md"),
  "裴照走进崇仁坊，右手按住刀柄。",
  "utf8",
);
const cleanEnv = () => {
  const { ELECTRON_RUN_AS_NODE, ...rest } = process.env;
  return rest;
};
const launch = () =>
  _electron.launch({
    executablePath: electron,
    args: [path.join(root, "out/main/index.js"), `--user-data-dir=${userData}`],
    cwd: root,
    env: {
      ...cleanEnv(),
      DEEPSEEK_API_KEY: key,
      WORDHUB_DEEPSEEK_API_KEY: key,
      WORDHUB_WORKSPACE_ROOT: root,
    },
  });
const database = () => {
  const id = fs
    .readdirSync(path.join(userData, "projects"))
    .find((name) =>
      fs.existsSync(path.join(userData, "projects", name, "wordhub.sqlite")),
    );
  return new DatabaseSync(
    path.join(userData, "projects", id, "wordhub.sqlite"),
    { readOnly: true },
  );
};
const events = () => {
  const db = database();
  const rows = db.prepare("SELECT * FROM events ORDER BY seq").all();
  db.close();
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
};
const waitEvent = async (runId, type, timeout = 300000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (events().some((event) => event.run_id === runId && event.type === type))
      return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`等待${type}超时`);
};
const app = await launch();
try {
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
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, folder);
  await page.click('[data-testid="link-folder"]');
  await page.waitForSelector('[data-testid="project-card"]');
  const waitForWorkflow = async (before, timeout = 300000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const current = events();
      const started = current.find(
        (event) => event.seq > before && event.type === "workflow.started",
      );
      if (started) return started;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("没有创建工作流");
  };
  const waitForWorkflowEvent = async (workflowId, types, timeout = 300000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const current = events();
      const found = current.find(
        (event) =>
          (event.run_id === workflowId ||
            event.payload?.workflowId === workflowId) &&
          types.includes(event.type),
      );
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`等待工作流事件超时：${types.join("/")}`);
  };
  const send = async (text) => {
    await page.fill('[data-testid="composer-input"]', text);
    await page.click('[data-testid="send"]');
  };

  const firstBefore = events().length;
  await send(
    "全流程写第三章。请保留现有正文中‘右手按住刀柄’这一动作，不要自行改成左手，让评审核验设定与正文的左右手矛盾。",
  );
  const firstWorkflow = await waitForWorkflow(firstBefore);
  const workflowId = firstWorkflow.run_id;
  const firstPhase = await waitForWorkflowEvent(workflowId, [
    "escalation.created",
    "workflow.finished",
    "workflow.failed",
  ]);
  if (firstPhase.type === "workflow.failed")
    throw new Error(
      `全流程失败：${String(firstPhase.payload?.error ?? "未知错误")}`,
    );
  await page.waitForSelector(".entry-agent", { timeout: 300000 });
  await page.waitForSelector("[data-testid=paper-sheet]", { timeout: 300000 });
  await page.waitForSelector(".usage-summary", { timeout: 300000 });
  await page.waitForSelector(".entry-thread", { timeout: 300000 });
  const challenged = firstPhase;
  const firstEvents = events();
  const challengeEvents = firstEvents.filter(
    (event) =>
      event.type === "challenge.raise" &&
      (event.payload?.workflowId === workflowId || event.run_id === workflowId),
  );
  if (!challengeEvents.length) throw new Error("真实评审未提出可见质询");
  if (
    !challengeEvents.some((event) =>
      /左|右/u.test(String(event.payload?.claim ?? "")),
    )
  )
    throw new Error("真实评审没有指出左右手矛盾");
  const firstAgents = firstEvents
    .filter((event) => event.type === "run.started" && event.payload?.agentId)
    .map((event) => event.payload.agentId);
  for (const agent of ["writer", "editor", "reviewer"])
    if (!firstAgents.includes(agent))
      throw new Error(`工作流缺少${agent}节点：${firstAgents.join(",")}`);
  const beforeDecision = fs.readFileSync(
    path.join(folder, "chapters", "第三章.md"),
    "utf8",
  );
  if (challenged.type === "escalation.created") {
    await page.locator(".approval:not(.resolved) .btn-primary").last().click();
    await waitForWorkflowEvent(workflowId, ["workflow.finished"], 300000);
  } else if (
    !firstEvents.some(
      (event) =>
        event.type === "challenge.resolved" &&
        event.payload?.workflowId === workflowId,
    )
  ) {
    throw new Error("质询既未升级裁决，也没有记录为已解决");
  }
  const afterDecision = events();
  const chapter = fs.readFileSync(
    path.join(folder, "chapters", "第三章.md"),
    "utf8",
  );
  if (chapter === beforeDecision && !/左手/u.test(chapter))
    throw new Error("质询处理后章节没有产生修订结果");

  const cleanStart = events().length;
  fs.writeFileSync(
    path.join(folder, "chapters", "第四章.md"),
    "裴照用左手按住刀柄，设定与正文一致。",
    "utf8",
  );
  await send(
    "请只评审第四章的一致性。第四章写的是：裴照是左撇子，本章明确写他用左手按住刀柄。不要依据第三章、历史对话或其他章节提出质询；若本章与设定一致，请直接说明无矛盾，不要调用challenge.raise。",
  );
  const cleanWorkflow = await waitForWorkflow(cleanStart);
  const cleanTerminal = await waitForWorkflowEvent(cleanWorkflow.run_id, [
    "workflow.finished",
    "workflow.failed",
    "escalation.created",
  ]);
  const cleanEvents = events().filter((event) => event.seq > cleanStart);
  if (cleanTerminal.type !== "workflow.finished")
    throw new Error("无矛盾章节被错误升级或失败");
  if (cleanEvents.some((event) => event.type === "challenge.raise"))
    throw new Error("无矛盾章节出现误报质询");

  const allStart = events().length;
  await send("@all 请分别给出当前项目的协作意见");
  const allWorkflow = await waitForWorkflow(allStart);
  await waitForWorkflowEvent(allWorkflow.run_id, ["workflow.finished"]);
  const allAgents = events()
    .filter(
      (event) =>
        event.run_id === allWorkflow.run_id ||
        event.payload?.workflowId === allWorkflow.run_id,
    )
    .filter((event) => event.type === "run.started" && event.payload?.agentId)
    .map((event) => event.payload.agentId);
  for (const agent of ["writer", "editor", "reviewer", "observer", "planner"])
    if (!allAgents.includes(agent))
      throw new Error(`all工作流缺少${agent}节点：${allAgents.join(",")}`);
  const result = {
    workflowId,
    agents: firstAgents,
    challenge: challengeEvents.length,
    escalation: firstEvents.some(
      (event) => event.type === "escalation.created",
    ),
    resolved: afterDecision.some(
      (event) => event.type === "escalation.resolved",
    ),
    chapter,
    allAgents,
  };
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", "m3-live-e2e-result.json"),
    JSON.stringify(result, null, 2),
    "utf8",
  );
  console.log("M3真实回归通过", JSON.stringify(result));
} finally {
  spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"], {
    stdio: "ignore",
  });
}
