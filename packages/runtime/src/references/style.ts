/** 文风示范：作者认可的参考片段，存成 .wordhub/bible/style-samples.md，注入写手/编辑/纲领的上下文。 */
export const STYLE_SAMPLES_FILE = ".wordhub/bible/style-samples.md";
export const STYLE_SAMPLE_LIMITS = {
  /** 最多保留几段 */
  count: 5,
  minChars: 20,
  maxChars: 600,
} as const;

export type StyleSample = {
  /** 出处说明，如《某书》第三章 某标题 */
  source: string;
  /** 参考库锚点，便于回查：ref-xxxx/0003/120-480 */
  anchor?: string;
  text: string;
};

const HEADER = [
  "# 文风示范",
  "",
  "作者认可的片段，仅用于学习笔法、节奏和语气；不得照抄其中的情节、人物和原句。",
  "",
].join("\n");

const quoteBlock = (text: string): string =>
  text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");

export function renderStyleSamples(samples: StyleSample[]): string {
  return `${HEADER}${samples
    .map(
      (sample, index) =>
        `## 示例 ${index + 1} · ${sample.source}\n${sample.anchor ? `来源：${sample.anchor}\n` : ""}\n${quoteBlock(sample.text)}\n`,
    )
    .join("\n")}`;
}

/** 解析 style-samples.md；格式不认识的内容忽略。 */
export function parseStyleSamples(markdown: string): StyleSample[] {
  const samples: StyleSample[] = [];
  const parts = markdown
    .replaceAll("\r\n", "\n")
    .split(/^## 示例 \d+ · /mu)
    .slice(1);
  for (const part of parts) {
    const lines = part.split("\n");
    const source = (lines.shift() ?? "").trim();
    let anchor: string | undefined;
    const body: string[] = [];
    for (const line of lines) {
      if (line.startsWith("来源：")) anchor = line.slice(3).trim();
      else if (line.startsWith(">")) body.push(line.replace(/^>[ ]?/u, ""));
    }
    const text = body.join("\n").trim();
    if (source && text) samples.push({ source, anchor, text });
  }
  return samples;
}

export class StyleSampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StyleSampleError";
  }
}

/** 追加一段示范；超出数量、长度不合适、重复都明确拒绝。返回新的文件内容。 */
export function addStyleSample(
  existing: string | undefined,
  sample: StyleSample,
): string {
  const text = sample.text.replaceAll("\r\n", "\n").trim();
  if (text.length < STYLE_SAMPLE_LIMITS.minChars)
    throw new StyleSampleError(
      `选段太短（${text.length} 字），至少 ${STYLE_SAMPLE_LIMITS.minChars} 字才看得出文风`,
    );
  if (text.length > STYLE_SAMPLE_LIMITS.maxChars)
    throw new StyleSampleError(
      `选段太长（${text.length} 字），每段示范不超过 ${STYLE_SAMPLE_LIMITS.maxChars} 字`,
    );
  const samples = existing ? parseStyleSamples(existing) : [];
  if (samples.length >= STYLE_SAMPLE_LIMITS.count)
    throw new StyleSampleError(
      `文风示范最多保留 ${STYLE_SAMPLE_LIMITS.count} 段，请先删掉不用的再添加`,
    );
  if (samples.some((item) => item.text === text))
    throw new StyleSampleError("这段文字已经在文风示范里了");
  return renderStyleSamples([...samples, { ...sample, text }]);
}

export function removeStyleSample(existing: string, index: number): string {
  const samples = parseStyleSamples(existing);
  if (!Number.isInteger(index) || index < 0 || index >= samples.length)
    throw new StyleSampleError("没有这一段示范");
  return renderStyleSamples(
    samples.filter((_, position) => position !== index),
  );
}
