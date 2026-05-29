// ─── vision.ts ───── Pi-configured vision model client ───────────────────
import { getVisionModel } from "./config.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model, Api } from "@earendil-works/pi-ai";

export interface VisionResult {
  text: string;
  provider: string;
  modelId: string;
}

/**
 * Call a Pi-configured vision model to analyze an image.
 *
 * Parses the config string (e.g. "opencode-go/kimi-k2.5") into provider + modelId,
 * looks up the model in the registry, builds the appropriate API payload format,
 * and calls the API.
 */
export async function callVision(
  ctx: ExtensionContext,
  prompt: string,
  imageBase64: string,
  mime: string,
  signal?: AbortSignal,
): Promise<VisionResult> {
  const configStr = getVisionModel();
  const slashIdx = configStr.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(
      `Invalid vision model config "${configStr}": expected "provider/modelId" (e.g. "opencode-go/kimi-k2.5")`,
    );
  }

  const provider = configStr.slice(0, slashIdx);
  const modelId = configStr.slice(slashIdx + 1);

  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) {
    throw new Error(
      `Vision model "${provider}/${modelId}" not found in model registry. ` +
        `Check your ~/.pi/tools.json vision.defaultModel config and ensure the provider is configured.`,
    );
  }

  if (!model.input.includes("image")) {
    throw new Error(
      `Model "${provider}/${modelId}" does not support image input. ` +
        `Choose a vision-capable model in ~/.pi/tools.json vision.defaultModel.`,
    );
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(
      `No API key configured for "${provider}". ${auth.error || "Run /login or configure auth."}`,
    );
  }

  const timeout = AbortSignal.timeout(120_000);
  // Merge external signal with timeout: if either aborts, abort the fetch.
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeout])
    : timeout;

  const dataUri = `data:${mime};base64,${imageBase64}`;

  const api = model.api as string;

  if (
    api === "openai-completions" ||
    api === "openai-responses" ||
    api === "openai-codex-responses"
  ) {
    return callOpenAICompatible(model, prompt, dataUri, auth.apiKey, auth.headers, combinedSignal, provider, modelId);
  }

  if (api === "anthropic-messages") {
    return callAnthropic(model, prompt, imageBase64, mime, auth.apiKey, auth.headers, combinedSignal, provider, modelId);
  }

  if (api === "google-generative-ai") {
    return callGoogle(model, prompt, imageBase64, mime, auth.apiKey, auth.headers, combinedSignal, provider, modelId);
  }

  throw new Error(
    `Unsupported vision API "${api}" for model "${provider}/${modelId}". ` +
      `Supported APIs: openai-completions, openai-responses, anthropic-messages, google-generative-ai.`,
  );
}

// ─── OpenAI-compatible (completions / responses) ────────────────────────

async function callOpenAICompatible(
  model: Model<Api>,
  prompt: string,
  dataUri: string,
  apiKey: string | undefined,
  headers: Record<string, string> | undefined,
  signal: AbortSignal,
  provider: string,
  modelId: string,
): Promise<VisionResult> {
  const url = `${model.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const body = {
    model: model.id,
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: dataUri },
          },
        ],
      },
    ],
    max_tokens: 4096,
  };

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };
  if (apiKey) {
    requestHeaders["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Vision API error (${provider}/${modelId}): HTTP ${res.status} - ${text.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    error?: { message?: string };
  };

  if (data.error) {
    throw new Error(
      `Vision API error (${provider}/${modelId}): ${data.error.message || JSON.stringify(data.error)}`,
    );
  }

  // openai-completions (chat/completions) response format
  const text = data.choices?.[0]?.message?.content?.trim();
  if (text) {
    return { text, provider, modelId };
  }

  // openai-responses response format
  const outputText = data.output?.[0]?.content
    ?.map((c) => c.text ?? "")
    .join("")
    .trim();
  if (outputText) {
    return { text: outputText, provider, modelId };
  }

  // Fallback: try to extract any text from the response
  throw new Error(
    `Vision API (${provider}/${modelId}): unexpected response format: ${JSON.stringify(data).slice(0, 500)}`,
  );
}

// ─── Anthropic Messages ─────────────────────────────────────────────────

async function callAnthropic(
  model: Model<Api>,
  prompt: string,
  imageBase64: string,
  mime: string,
  apiKey: string | undefined,
  headers: Record<string, string> | undefined,
  signal: AbortSignal,
  provider: string,
  modelId: string,
): Promise<VisionResult> {
  const url = `${model.baseUrl.replace(/\/+$/, "")}/v1/messages`;

  const body = {
    model: model.id,
    max_tokens: 4096,
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mime,
              data: imageBase64,
            },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  };

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    ...headers,
  };
  if (apiKey) {
    requestHeaders["x-api-key"] = apiKey;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Vision API error (${provider}/${modelId}): HTTP ${res.status} - ${text.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };

  if (data.error) {
    throw new Error(
      `Vision API error (${provider}/${modelId}): ${data.error.message || JSON.stringify(data.error)}`,
    );
  }

  const text = data.content
    ?.filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error(
      `Vision API (${provider}/${modelId}): no text content in response`,
    );
  }

  return { text, provider, modelId };
}

// ─── Google Generative AI ───────────────────────────────────────────────

async function callGoogle(
  model: Model<Api>,
  prompt: string,
  imageBase64: string,
  mime: string,
  apiKey: string | undefined,
  headers: Record<string, string> | undefined,
  signal: AbortSignal,
  provider: string,
  modelId: string,
): Promise<VisionResult> {
  const url = `${model.baseUrl.replace(/\/+$/, "")}/v1beta/models/${model.id}:generateContent?key=${apiKey || ""}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mime, data: imageBase64 } },
        ],
      },
    ],
  };

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Vision API error (${provider}/${modelId}): HTTP ${res.status} - ${text.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    error?: { message?: string };
  };

  if (data.error) {
    throw new Error(
      `Vision API error (${provider}/${modelId}): ${data.error.message || JSON.stringify(data.error)}`,
    );
  }

  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error(
      `Vision API (${provider}/${modelId}): no text content in response`,
    );
  }

  return { text, provider, modelId };
}
