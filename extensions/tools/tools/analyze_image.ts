// ─── analyze_image ───── Vision analysis via Pi-configured models ─────
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { callVision } from "../lib/vision.js";
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

    async execute(_id, params, _signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Loading image..." }] });

      try {
        const image = await loadImageBytes(params.image_path);
        const sizeKB = Math.round(Buffer.byteLength(image.base64, "base64") / 1024);
        onUpdate?.({ 
          content: [{ 
            type: "text", 
            text: image.wasResized 
              ? `Resized ${image.originalWidth}x${image.originalHeight} → ${image.width}x${image.height} (${sizeKB}KB). Analyzing...`
              : `Analyzing image (${sizeKB}KB)...`
          }] 
        });

        const prompt = params.question?.trim()
          || "Mô tả chi tiết bức ảnh này bằng tiếng Việt.";

        const result = await callVision(ctx, prompt, image.base64, image.mime, _signal);

        return {
          content: [{ type: "text", text: result.text }],
          details: { 
            mime: image.mime, 
            prompt: prompt.slice(0, 100), 
            provider: result.provider, 
            modelId: result.modelId,
            originalSize: image.wasResized ? `${image.originalWidth}x${image.originalHeight}` : undefined,
            resizedTo: image.wasResized ? `${image.width}x${image.height}` : undefined,
          },
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

      const details = result.details as { 
        mime?: string; 
        error?: string; 
        provider?: string; 
        modelId?: string;
        originalSize?: string;
        resizedTo?: string;
      } | undefined;
      if (details?.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);

      const content = result.content[0];
      const text = content?.type === "text" ? content.text : "";
      const lineCount = text.split("\n").length;

      let display = theme.fg("success", `${lineCount} lines`);
      if (details?.provider && details?.modelId) {
        display += theme.fg("dim", ` · ${details.provider}/${details.modelId}`);
      }
      if (details?.originalSize && details?.resizedTo) {
        display += theme.fg("dim", ` · resized ${details.originalSize}→${details.resizedTo}`);
      }

      if (expanded) {
        const preview = text.split("\n").slice(0, 15).join("\n");
        display += `\n${theme.fg("toolOutput", preview)}`;
        if (lineCount > 15) display += `\n${theme.fg("muted", `... ${lineCount - 15} more lines`)}`;
      }

      return new Text(display, 0, 0);
    },
  });
}
