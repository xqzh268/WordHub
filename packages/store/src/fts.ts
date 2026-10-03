/** SQLite unicode61 不会把中文词切成可检索的 token；逐字空格化后再做 phrase 查询。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu;

export function normalizeSearchText(value: string): string {
  return value
    .replace(CJK, (character) => ` ${character} `)
    .replace(/\s+/gu, " ")
    .trim();
}

export function searchPhrase(value: string): string {
  const normalized = normalizeSearchText(value);
  if (!normalized) return "";
  return `"${normalized.replaceAll('"', '""')}"`;
}
