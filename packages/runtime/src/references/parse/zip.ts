import JSZip from "jszip";
import { LIMITS, ReferenceLibraryError } from "../types.js";

/** 打开 EPUB/DOCX：限制条目数与解压总量，防 zip 炸弹。 */
export async function openZip(buffer: Buffer, label: string): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new ReferenceLibraryError(
      `${label}文件已损坏或不是有效的压缩包，无法读取`,
    );
  }
  const names = Object.keys(zip.files);
  if (names.length > LIMITS.zipEntries)
    throw new ReferenceLibraryError(
      `${label}文件内的条目过多（${names.length}），已拒绝`,
    );
  let total = 0;
  for (const name of names) {
    const data = (
      zip.files[name] as unknown as {
        _data?: { uncompressedSize?: number };
      }
    )._data;
    total += data?.uncompressedSize ?? 0;
  }
  if (total > LIMITS.zipUncompressedBytes)
    throw new ReferenceLibraryError(`${label}文件解压后过大，已拒绝`);
  return zip;
}

export async function readEntry(
  zip: JSZip,
  entry: string,
): Promise<string | undefined> {
  const file = zip.file(entry);
  return file ? file.async("string") : undefined;
}

/** 解析 EPUB 内 href（相对所在目录，可能带 ../ 和 #fragment）为压缩包内路径。 */
export function resolveEntry(baseDir: string, href: string): string {
  const clean = decodeURIComponent(href.split("#")[0] ?? "");
  const parts = `${baseDir}${clean}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}
