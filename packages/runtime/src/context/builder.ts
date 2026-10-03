import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { BuiltContext, ContextLayer } from "../types.js";

const estimateTokens = (text: string): number => Math.ceil(text.length / 2);

export class ContextBuilder {
  constructor(private readonly maxTokens = 12000) {}
  build(layers: readonly ContextLayer[], userPrompt: string): BuiltContext {
    let remaining = this.maxTokens;
    const manifest = layers.map((layer) => ({
      ...layer,
      text: (() => {
        const maxChars = Math.max(0, remaining * 2);
        const text = layer.text.slice(0, maxChars);
        remaining -= estimateTokens(text);
        return text;
      })(),
      estimatedTokens: 0,
    }));
    for (const layer of manifest)
      layer.estimatedTokens = estimateTokens(layer.text);
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
    const prompt = userPrompt.slice(0, Math.max(0, remaining * 2));
    messages.push({ role: "user", content: prompt, timestamp: Date.now() });
    return {
      messages,
      manifest,
      estimatedTokens:
        manifest.reduce((sum, layer) => sum + layer.estimatedTokens, 0) +
        estimateTokens(prompt),
    };
  }
}
