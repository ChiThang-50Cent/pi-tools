// ─── store.ts ────── In-memory content storage for get_search_content ───
import { randomUUID } from "node:crypto";

export type StoredContent = {
  responseId: string;
  type: "search" | "fetch";
  timestamp: number;
  queries?: { query: string; answer: string; results: { title: string; url: string }[] }[];
  urls?: { url: string; title: string; content: string; error?: string }[];
};

export const contentStore = new Map<string, StoredContent>();

export function generateId(): string {
  return randomUUID().slice(0, 8);
}
