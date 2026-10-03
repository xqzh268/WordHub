import { contextBridge, ipcRenderer } from "electron";
import type {
  AppEvent,
  CommandPayloads,
  CommandResults,
  WorkspaceCommand,
} from "@wordhub/contracts";

const api = {
  invoke<C extends WorkspaceCommand>(
    command: C,
    payload: CommandPayloads[C],
  ): Promise<CommandResults[C]> {
    return ipcRenderer.invoke("wordhub:invoke", {
      command,
      payload,
    }) as Promise<CommandResults[C]>;
  },
  subscribe(listener: (event: AppEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, message: AppEvent) =>
      listener(message);
    ipcRenderer.on("wordhub:event", handler);
    return () => ipcRenderer.removeListener("wordhub:event", handler);
  },
};

contextBridge.exposeInMainWorld("wordhub", api);

declare global {
  interface Window {
    wordhub: typeof api;
  }
}
