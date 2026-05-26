// ─── image.ts ────── Image loading from file/URL/data URI ────────────────
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAX_IMAGE_MB = 20;

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".bmp": "image/bmp",
};

export async function loadImageBytes(source: string): Promise<{ base64: string; mime: string }> {
  // Data URI
  if (source.startsWith("data:")) {
    const [header, b64] = source.split(",", 2);
    const mime = header.split(":")[1]?.split(";")[0] || "image/png";
    return { base64: b64, mime };
  }

  // URL
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const res = await fetch(source, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type") || "image/png";
    return { base64: buffer.toString("base64"), mime };
  }

  // Local file
  const filePath = resolve(source.replace(/^~/, process.env.HOME || ""));
  const fs = await import("node:fs/promises");

  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`File not found: ${source}`);
  }

  const stat = await fs.stat(filePath);
  if (stat.size > MAX_IMAGE_MB * 1024 * 1024) {
    throw new Error(`Image exceeds ${MAX_IMAGE_MB}MB limit`);
  }

  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const mime = MIME_MAP[ext] || "image/png";
  const buffer = readFileSync(filePath);

  return { base64: buffer.toString("base64"), mime };
}
