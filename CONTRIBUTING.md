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
