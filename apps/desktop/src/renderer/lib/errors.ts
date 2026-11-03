/** Electron 的 invoke 会给错误信息套上 "Error invoking remote method '…': Error: " 前缀，界面上只留真正的原因。 */
export function cleanIpcError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/u, "")
    .replace(/^(?:\w*Error):\s*/u, "")
    .trim();
}
