import type { Message } from "../../../shared/model.ts";

/** Ids of messages whose text or author contains the query (case-insensitive). */
export const findMatches = (messages: Message[], query: string): number[] => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  return messages
    .filter(
      (m) =>
        m.body.toLowerCase().includes(q) ||
        m.authorName.toLowerCase().includes(q)
    )
    .map((m) => m.id);
};
