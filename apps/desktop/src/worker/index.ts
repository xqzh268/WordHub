import path from "node:path";
import { createRunExecutor, type RuntimeRequest } from "@wordhub/runtime";

type ParentPort = {
  on(
    event: "message",
    listener: (event: { data: RuntimeRequest }) => void,
  ): void;
  postMessage(message: unknown): void;
};
const port = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!port) throw new Error("WordHub worker requires Electron utilityProcess");
const executor = createRunExecutor({
  workspaceRoot: process.env.WORDHUB_WORKSPACE_ROOT ?? process.cwd(),
  storageRoot:
    process.env.WORDHUB_STORAGE_ROOT ??
    path.join(process.env.LOCALAPPDATA ?? process.cwd(), "WordHub"),
  post: (message) => port.postMessage(message),
});
port.on("message", ({ data }) => {
  void executor.handle(data);
});
executor.ready.then(() =>
  port.postMessage({ type: "ready", pid: process.pid }),
);
