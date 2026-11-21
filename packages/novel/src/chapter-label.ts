/** 图谱中的事实可能来自历史文件，展示时去掉目录和最后一个扩展名。 */
export function chapterBasenameWithoutExtension(chapter: string): string {
  const name = chapter.replaceAll("\\", "/").split("/").at(-1) ?? chapter;
  return name.replace(/\.[^.]+$/u, "");
}
