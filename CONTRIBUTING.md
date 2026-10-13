# 贡献指南

文枢使用npm workspaces、TypeScript strict、Electron和React。Windows是P1的第一目标平台。使用说明见[README](README.md)，当前实现与验收边界见[M4进展](docs/m4-progress.md)。建议使用Node.js24；版本以`package.json`与锁文件为准。

开始前执行：

```powershell
npm ci
npm run validate:schema
npm run typecheck
npm run build:desktop
```

提交前运行下面的常规门禁，与Windows CI保持一致。涉及Pi、SuperDoc或foliate-js的适配时，同时运行对应的`npm run spike:*`并把结果写入`docs`或关联的验证报告。密钥只从进程环境变量或本地安全存储读取，不得写进事件、日志、fixture或提交内容。

```powershell
npm run validate:schema
npm run typecheck
npm run lint
npm test
npm run test:m2:faux
npm run test:m1:store
npm run build:desktop
npm run test:desktop
npm run test:layout
npm run test:m1:e2e
```

真实模型回归是另一条验收门禁，会产生费用。准备进程环境中的`DEEPSEEK_API_KEY`后运行`npm run test:m3:live`与`npm run test:m3:neutral`；设置`WORDHUB_REQUIRE_LIVE=1`可避免缺密钥被当作通过。记录“通过、失败、跳过、未运行”及具体场景；不要用faux结果代替真实模型判断力验收。

Pull Request需要说明变更目的、验证命令、Windows行为和已知限制。提交即表示接受[CLA](CLA.md)。

## 本地开发提示

- 如果你的终端（尤其是 VS Code / 其他 IDE 内置终端）设置了 `ELECTRON_RUN_AS_NODE=1`，Electron 会被当作 Node 运行，应用无法启动。仓库内的脚本已自动规避；手动运行 `electron` 前请先 `unset ELECTRON_RUN_AS_NODE`（PowerShell：`Remove-Item Env:ELECTRON_RUN_AS_NODE`）。
- `npm run dev:desktop` 启动开发模式；加上环境变量 `WORDHUB_DEMO=1` 可载入设计预览数据，`WORDHUB_MOCK=1` 使用不调用模型的模拟后台。
- 回归结果默认写入`artifacts/`；提交时只纳入与此次验收相关的结果，不混入临时绝对路径或无关测试产物。
