const fs = require("fs");
const f = "scripts/references-live-e2e.mjs";
let t = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const rep = (a, b) => { if (!t.includes(a)) throw new Error("未找到: " + a.slice(0, 60)); t = t.replace(a, b); };
rep(`const toolNames = (slice) =>
  slice
    .filter((e) => /^tool\./u.test(e.type))
    .map((e) => String(e.payload.tool ?? e.payload.name ?? ""));`, `const toolNames = (slice) =>
  slice
    .filter((e) => e.type === "run.tool_started")
    .map((e) => String(e.payload.tool ?? ""));`);
const s = t.indexOf("  // ── 3. 没有参考库读取范围的 Agent：权限层拒绝");
const e = t.indexOf("} catch (error) {", s);
if (s < 0 || e < 0) throw new Error("section");
t = t.slice(0, s) + `  // ── 3. 声明了工具、却没有参考库读取范围的 Agent：权限层拒绝 ───────
  // 表单不允许这种组合（会被校验拦下），只能手写 AGENT.md；应用运行中新增，@ 它时自动刷新。
  const sneaky = path.join(folder, ".wordhub", "agents", "sneaky");
  fs.mkdirSync(sneaky, { recursive: true });
  fs.writeFileSync(
    path.join(sneaky, "AGENT.md"),
    [
      "---",
      "name: sneaky",
      "displayName: 偷看",
      "description: 声明了参考库工具但没有参考库读取范围",
      "model: { provider: deepseek, id: deepseek-flash, reasoning: low }",
      "tools: [reference.list, reference.search, reference.read]",
      "write: none",
      "writeScopes: []",
      "memoryScopes: { read: [chapters], write: [] }",
      "maxTurns: 4",
      "---",
      "你按用户要求调用工具，并把工具返回的结果原样告诉用户。",
    ].join("\n"),
  );
  const denied = await ask(
    "@偷看 请调用 reference.search，query 设为“台阶”，把工具返回的结果原样告诉我。",
  );
  const deniedEvent = denied.find(
    (e) =>
      e.type === "permission.denied" ||
      JSON.stringify(e.payload).includes("没有参考库的读取范围"),
  );
  check(
    "声明了工具但没有 references 读取范围：权限层拒绝并留下事件",
    Boolean(deniedEvent),
    deniedEvent ? JSON.stringify(deniedEvent.payload).slice(0, 160) : textOf(denied).slice(0, 160),
  );
  check(
    "被拒绝的 Agent 没有拿到书里的内容",
    !textOf(denied).includes("月光落在第七级台阶上"),
  );
` + t.slice(e);
fs.writeFileSync(f, t);
