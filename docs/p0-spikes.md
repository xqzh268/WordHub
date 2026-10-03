# P0 技术验证记录

执行环境：Windows、Node `v24.11.1`（满足Pi要求的`>=22.19.0`）。依赖版本锁定在`package.json`/`package-lock.json`。脚本均在项目根目录执行，结果JSON写入`artifacts/`。

## 1. Pi + DeepSeek 独立工作进程

实现位置：[`scripts/pi-worker.mjs`](../scripts/pi-worker.mjs)由[`scripts/spike-pi-worker.mjs`](../scripts/spike-pi-worker.mjs)通过`child_process.spawn`启动；worker使用`@earendil-works/pi-agent-core@1.0.0`和`@earendil-works/pi-ai@1.0.0`的`createModels()`/`deepseekProvider()`，模型默认`deepseek-flash`，真实调用只读取`DEEPSEEK_API_KEY`。

已验证：独立进程的JSONL输入输出、事件转发和退出码，见[`pi-worker-smoke-result.json`](../artifacts/pi-worker-smoke-result.json)；mock transport产生`agent_start → message_update → agent_end`，仅证明进程边界和协议。

真实DeepSeek状态：**已通过（2026-10-03补测）**。在设置了`DEEPSEEK_API_KEY`的shell中运行`npm run spike:pi`：worker以`deepseek-flash`、`reasoning: low`完成`agent_start → turn_start → message_start → message_update×N → message_end → turn_end → agent_end`，退出码0，返回文本“Pi独立工作进程已运行。”，见[`pi-worker-result.json`](../artifacts/pi-worker-result.json)。（首次执行时所用会话未设置密钥，脚本如实记为`not-run`。）

M0已补测Electron实际后台边界：`npm run spike:pi:utility`使用`utilityProcess`运行同一Pi worker，在中文路径下验证流式任务取消、进程杀死后的自动重启，以及`deepseek-v4-pro`和`deepseek-flash`在`reasoning: high`下各完成两轮`wordhub_echo`工具调用，见[`pi-utility-result.json`](../artifacts/pi-utility-result.json)。

M0的Node/jsdom SuperDoc预研见[`superdoc-node-result.json`](../artifacts/superdoc-node-result.json)：SuperDoc可以构造，但因浏览器Worker在Node/jsdom不可用而无法进入可编辑状态，不能作为小说Agent后台写入路径。

仍未覆盖、转入P1 M0：Electron `utilityProcess`（本次为`child_process`）、`abort()`取消、worker崩溃重启、中文路径、DeepSeek思考模式下的**工具调用**多轮（`requiresReasoningContentOnAssistantMessages`）。

## 2. SuperDoc 读写中文DOCX

实现位置：[`scripts/spike-superdoc.mjs`](../scripts/spike-superdoc.mjs)。脚本用`docx@9.8.1`生成含中文标题、段落和表格的样本，用Playwright Chromium加载`superdoc@2.20.0`，设置本地DOCX Engine路径，等待`storeDocs.ready=true`，通过`activeEditor.authoring.replaceTextByText()`替换中文标题，再用`activeEditor.exportDocx()`导出，并用`yauzl`检查`word/document.xml`。

结果：通过。读取到中文文本，替换结果为“文枢中文DOCX已写回”，导出8247字节，输出包内含替换后的中文文本；完整记录见[`superdoc-result.json`](../artifacts/superdoc-result.json)，输入/输出文件为[`superdoc-chinese-input.docx`](../artifacts/superdoc-chinese-input.docx)和[`superdoc-chinese-output.docx`](../artifacts/superdoc-chinese-output.docx)。

注意：SuperDoc社区版为AGPL-3.0；P0脚本使用本地引擎文件，避免把读写结果依赖在远端CDN上。

## 3. foliate-js 读取EPUB和MOBI

实现位置：[`scripts/spike-foliate.mjs`](../scripts/spike-foliate.mjs)。脚本用一个最小中文EPUB和Project Gutenberg公开无DRM MOBI，浏览器中调用`foliate-js@1.0.1`的`makeBook()`，读取首章节元数据和正文文本。

结果：通过。EPUB读取1个section，标题“文枢电子书样本”，正文包含中文章节；MOBI读取85个section，标题“Pride and Prejudice”。完整记录见[`foliate-result.json`](../artifacts/foliate-result.json)。该结果只覆盖无DRM文件，不代表可读取受保护电子书。

## 可重复命令

```powershell
npm install
npm run validate:schema
npm run spike:superdoc
npm run spike:foliate
# 真实DeepSeek验收（先在当前会话设置DEEPSEEK_API_KEY）
npm run spike:pi
```

契约校验通过：事件、事实、图谱、模型配置和AGENT.md示例均通过AJV Draft 2020-12验证。Pi真实密钥验收已补齐，P0门槛全部通过；后续计划见[`p1-plan.md`](p1-plan.md)。
