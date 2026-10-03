# 贡献指南

文枢使用npm workspaces、TypeScript strict、Electron和React。Windows是P1的第一目标平台。

开始前执行：

```powershell
npm ci
npm run validate:schema
npm run typecheck
npm run build:desktop
```

提交前至少运行`npm run test:desktop`。涉及Pi、SuperDoc或foliate-js时，同时运行对应的`npm run spike:*`并把结果写入`docs`或关联的验证报告。密钥只从环境变量或本地安全存储读取，不得写进事件、日志、fixture或提交内容。

Pull Request需要说明变更目的、验证命令、Windows行为和已知限制。提交即表示接受[CLA](CLA.md)。

## 本地开发提示

- 如果你的终端（尤其是 VS Code / 其他 IDE 内置终端）设置了 `ELECTRON_RUN_AS_NODE=1`，Electron 会被当作 Node 运行，应用无法启动。仓库内的脚本已自动规避；手动运行 `electron` 前请先 `unset ELECTRON_RUN_AS_NODE`（PowerShell：`Remove-Item Env:ELECTRON_RUN_AS_NODE`）。
- `npm run dev:desktop` 启动开发模式；加上环境变量 `WORDHUB_DEMO=1` 可载入设计预览数据，`WORDHUB_MOCK=1` 使用不调用模型的模拟后台。
- 提交前运行 `npm run validate:schema && npm run typecheck && npm run build:desktop && npm run test:desktop`，与 CI 保持一致。
