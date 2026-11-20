import agentConfigSchema from "@wordhub/contracts/schema/agent-config.schema.json" with {
  type: "json",
};
import modelConfigSchema from "@wordhub/contracts/schema/model-config.schema.json" with {
  type: "json",
};
import { Ajv2020 } from "ajv/dist/2020.js";

// schema 以 JSON 模块静态导入：打包时直接内联进 bundle，运行时不再依赖 node_modules 里的 @wordhub/contracts
const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const schema of [modelConfigSchema, agentConfigSchema])
  ajv.addSchema(schema);
export function validateConfig(
  kind: "agent-config" | "model-config",
  value: unknown,
): void {
  const validate = ajv.getSchema(
    `https://wordhub.local/schema/${kind}.schema.json`,
  );
  if (!validate?.(value))
    throw new Error(
      validate?.errors
        ?.map((error) => `${error.instancePath || "/"} ${error.message}`)
        .join("；") || "配置验证失败",
    );
}
