import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { BuiltContext, ContextLayer } from "../types.js";

const estimateTokens = (text: string): number => Math.ceil(text.length / 2);

export class ContextBuilder {
  build(layers: readonly ContextLayer[], userPrompt: string): BuiltContext {
    const manifest = layers.map((layer) => ({
      ...layer,
      estimatedTokens: estimateTokens(layer.text),
    }));
    const contextText = manifest
      .map((layer) => `【${layer.kind}:${layer.id}】\n${layer.text}`)
      .join("\n\n");
    const messages: AgentMessage[] = [];
    if (contextText)
      messages.push({
        role: "user",
        content: contextText,
        timestamp: Date.now(),
      });
    messages.push({ role: "user", content: userPrompt, timestamp: Date.now() });
    return {
      messages,
      manifest,
      estimatedTokens:
        manifest.reduce((sum, layer) => sum + layer.estimatedTokens, 0) +
        estimateTokens(userPrompt),
    };
  }
}
