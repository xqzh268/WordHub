# M0工程基线与遗留验证报告

日期：2026-10-03

M0完成了Electron桌面壳、类型化IPC、utilityProcess后台Agent、仓库治理文件和Windows CI基线。小说正文继续采用P1计划中的D1-A：Markdown是真相源；SuperDoc保留给P4科研/基金的Word模式。

## 已交付

- `apps/desktop`：Electron主进程、sandbox兼容的CJS preload、React三栏渲染进程和独立Pi utilityProcess worker。
- `packages/contracts`：P0 domain与JSON Schema的工作区包；AGENT配置schema升为v2，只在`model.reasoning`保存思考强度。
- 类型化IPC：主进程只处理`workspace.*`与`run.*`命令，渲染进程只得到`invoke`和事件订阅，Node API与密钥不暴露给页面。
- 仓库基线：Git、AGPL-3.0、CLA、贡献指南、Windows GitHub Actions。

## Pi utilityProcess验证

命令：`npm run spike:pi:utility`

报告：[`artifacts/pi-utility-result.json`](../artifacts/pi-utility-result.json)

- `deepseek-v4-pro` + `reasoning: high`：两次`wordhub_echo`工具调用后完成回答。
- `deepseek-flash` + `reasoning: high`：两次`wordhub_echo`工具调用后完成回答。
- 中文项目路径：`artifacts/文枢-M0-中文路径`。
- 取消：mock流式任务收到abort并产生`run.aborted`。
- 崩溃重启：杀掉utilityProcess后状态进入`crashed`，重新启动后恢复`ready`。

## SuperDoc Node/jsdom预研

命令：`npm run spike:superdoc:node`

报告：[`artifacts/superdoc-node-result.json`](../artifacts/superdoc-node-result.json)

结果是**不支持作为后台写入路径**：SuperDoc在jsdom中可以构造，但文档编辑器依赖浏览器Worker运行时，Node/jsdom报告`worker-unavailable`并无法完成ready/编辑。因此P1不把DOCX作为小说正文真相源，P4继续在浏览器编辑器中使用SuperDoc。

## 桌面壳烟测

命令：`npm run test:desktop`

已验证窗口加载、三栏界面、preload IPC、mock worker流式事件和页面状态更新。
