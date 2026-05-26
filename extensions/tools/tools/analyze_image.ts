// ─── analyze_image ───── Vision analysis via Ollama (Gemma 3 4B) ────────
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ollamaVision } from "../lib/ollama.js";
import { truncateOutput } from "../lib/truncate.js";
import { loadImageBytes } from "../lib/image.js";

const OUTPUT_CAP = 300; // show ~a few lines, full output in details

export function registerAnalyzeImage(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "analyze_image",
    label: "Analyze Image",
    description:
      "Analyze an image: describe, read text, or answer questions.\n\n" +
      "You MUST use this tool whenever you receive an image from the user " +
      "or need to understand visual content. Supports Vietnamese & English.\n\n" +
      "Usage:\n" +
      '- Omit question → detailed Vietnamese description\n' +
      '- question="Đọc tất cả chữ" → extract text (OCR)\n' +
      '- question="How many cars?" → answer specific questions',
    promptSnippet: "Analyze images with vision model (Vietnamese + English)",
    promptGuidelines: [
      "You MUST call analyze_image when the user sends an image. Always include the file path.",
      "For Vietnamese images, omit the question parameter for a default Vietnamese description.",
    ],
    parameters: Type.Object({
      image_path: Type.String({ description: "Local file path, URL, or base64 data URI" }),
      question: Type.Optional(Type.String({ description: "What to ask. Omit for Vietnamese description." })),
    }),

    async execute(_id, params, _signal, onUpdate) {
      onUpdate?.({ content: [{ type: "text", text: "Loading image..." }] });

      try {
        const { base64, mime } = await loadImageBytes(params.image_path);
        onUpdate?.({ content: [{ type: "text", text: `Analyzing with vision model...` }] });

        const prompt = params.question?.trim()
          || "Mô tả chi tiết bức ảnh này bằng tiếng Việt.";

        const result = await ollamaVision(prompt, base64);
        const output = truncateOutput(result);

        return {
          content: [{ type: "text", text: output.text }],
          details: { mime, prompt: prompt.slice(0, 100), ...(output.truncated ? { fullOutput: result } : {}) },
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `analyze_image failed: ${e}` }],
          details: { error: String(e) },
        };
      }
    },
  });
}
