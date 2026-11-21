import { EMPTY_ROW, type ModelRow, type ThinkSetting } from "./model-draft";

const THINK_LABELS: Record<ThinkSetting, string> = {
  none: "不支持思考",
  auto: "思考：自动",
  minimal: "思考最高 minimal",
  low: "思考最高 low",
  medium: "思考最高 medium",
  high: "思考最高 high",
  xhigh: "思考最高 xhigh",
  max: "思考最高 max",
};

export function ProviderModelRows({
  rows,
  onChange,
}: {
  rows: ModelRow[];
  onChange: (update: (rows: ModelRow[]) => ModelRow[]) => void;
}) {
  const patchRow = (index: number, patch: Partial<ModelRow>) =>
    onChange((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  return (
    <>
      {rows.map((row, index) => (
        <div
          key={index}
          className="credential-row"
          style={{ marginTop: 0, flexWrap: "wrap" }}
          data-testid={`model-row-${index}`}
        >
          <input
            className="text-input mono"
            value={row.id}
            onChange={(event) => patchRow(index, { id: event.target.value })}
            placeholder="模型ID"
            aria-label={`模型ID-${index}`}
          />
          <input
            className="text-input"
            value={row.label}
            onChange={(event) => patchRow(index, { label: event.target.value })}
            placeholder="显示名（可空）"
            aria-label={`显示名-${index}`}
          />
          <input
            className="text-input mono"
            value={row.contextWindow}
            onChange={(event) =>
              patchRow(index, { contextWindow: event.target.value })
            }
            placeholder="上下文长度（默认128000）"
            aria-label={`上下文长度-${index}`}
          />
          <input
            className="text-input mono"
            value={row.maxOutput}
            onChange={(event) =>
              patchRow(index, { maxOutput: event.target.value })
            }
            placeholder="最大输出（默认8192）"
            aria-label={`最大输出-${index}`}
          />
          <input
            className="text-input mono"
            value={row.input}
            onChange={(event) => patchRow(index, { input: event.target.value })}
            placeholder="输入价 $/百万token"
            aria-label={`输入价格-${index}`}
          />
          <input
            className="text-input mono"
            value={row.output}
            onChange={(event) =>
              patchRow(index, { output: event.target.value })
            }
            placeholder="输出价 $/百万token"
            aria-label={`输出价格-${index}`}
          />
          <select
            className="text-input"
            value={row.think}
            onChange={(event) =>
              patchRow(index, {
                think: event.target.value as ThinkSetting,
              })
            }
            aria-label={`思考档位-${index}`}
          >
            {(Object.keys(THINK_LABELS) as ThinkSetting[]).map((value) => (
              <option key={value} value={value}>
                {THINK_LABELS[value]}
              </option>
            ))}
          </select>
          <button
            className="btn"
            disabled={rows.length === 1}
            onClick={() =>
              onChange((current) => current.filter((_, i) => i !== index))
            }
            aria-label={`删除模型行-${index}`}
          >
            删除
          </button>
        </div>
      ))}
      <div>
        <button
          className="btn"
          onClick={() => onChange((current) => [...current, { ...EMPTY_ROW }])}
        >
          添加模型行
        </button>
      </div>
    </>
  );
}
