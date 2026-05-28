// ─── analyze_image ───── Vision analysis via Ollama (Gemma 3 4B) ────────
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ollamaVision } from "../lib/ollama.js";
import { loadImageBytes } from "../lib/image.js";

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

        return {
          content: [{ type: "text", text: result }],
          details: { mime, prompt: prompt.slice(0, 100) },
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `analyze_image failed: ${e}` }],
          details: { error: String(e) },
        };
      }
    },

    renderCall(args, theme) {
      const path = typeof args.image_path === "string" ? args.image_path : "";
      const q = typeof args.question === "string" ? args.question.trim() : "";
      let text = theme.fg("toolTitle", theme.bold("image ")) + theme.fg("accent", path.slice(0, 60));
      if (q) text += theme.fg("dim", ` "${q.slice(0, 40)}"`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Analyzing..."), 0, 0);

      const details = result.details as { mime?: string; error?: string } | undefined;
      if (details?.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);

      const content = result.content[0];
      const text = content?.type === "text" ? content.text : "";
      const lineCount = text.split("\n").length;
      const sizeKB = (Buffer.byteLength(text, "utf8") / 1024).toFixed(1);

      let display = theme.fg("success", `${lineCount} lines`) + theme.fg("dim", ` (${sizeKB}KB)`);
      if (details?.mime) display += theme.fg("dim", ` · ${details.mime}`);

      if (expanded) {
        const preview = text.split("\n").slice(0, 15).join("\n");
        display += `\n${theme.fg("toolOutput", preview)}`;
        if (lineCount > 15) display += `\n${theme.fg("muted", `... ${lineCount - 15} more lines`)}`;
      }

      return new Text(display, 0, 0);
    },
  });
}
