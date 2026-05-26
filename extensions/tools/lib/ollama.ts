// ─── ollama.ts ───── Ollama vision API client ─────────────────────────────
import { getOllamaUrl, getVisionModel } from "./config.js";
import type { OllamaResponse } from "./types.js";

export async function ollamaVision(
  prompt: string,
  imageBase64: string,
): Promise<string> {
  const url = `${getOllamaUrl()}/api/generate`;
  const model = getVisionModel();

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      images: [imageBase64],
      stream: false,
      keep_alive: "5m",
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as OllamaResponse;
  return (data.response || "").trim();
}
