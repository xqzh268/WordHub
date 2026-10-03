import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Ajv2020 } from "ajv/dist/2020.js";

const require = createRequire(import.meta.url);
const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const name of ["model-config", "agent-config"]) {
  ajv.addSchema(
    JSON.parse(
      readFileSync(
        require.resolve(`@wordhub/contracts/schema/${name}.schema.json`),
        "utf8",
      ),
    ),
  );
}
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
