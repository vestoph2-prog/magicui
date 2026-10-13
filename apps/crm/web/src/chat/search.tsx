import { useEffect, useMemo, useState } from "react";
import type { Message } from "../../../shared/model.ts";
import { findMatches } from "./match.ts";
import { scrollToMessage } from "./timeline.tsx";

/**
 * Sticky search bar over the task chat. The whole chat is already loaded,
 * so searching is instant and works offline in a basement.
 */
export const ChatSearch = ({
  messages,
  onMatches,
  onClose,
}: {
  messages: Message[];
  onMatches: (ids: ReadonlySet<number>) => void;
  onClose: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const matches = useMemo(
    () => findMatches(messages, query),
    [messages, query]
  );

  useEffect(() => {
    onMatches(new Set(matches));
    // Newest match first, like messengers do.
    setIndex(Math.max(0, matches.length - 1));
  }, [matches, onMatches]);

  const current = matches[index];
  useEffect(() => {
    if (current !== undefined) {
      scrollToMessage(current);
    }
  }, [current]);

  const step = (delta: number) => {
    if (matches.length) {
      setIndex((i) => (i + delta + matches.length) % matches.length);
    }
  };

  return (
    <div className="chat-search">
      <input
        aria-label="Поиск по чату"
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по сообщениям…"
        type="search"
        value={query}
      />
      <span className="hint">
        {query.trim()
          ? `${matches.length ? index + 1 : 0} / ${matches.length}`
          : ""}
      </span>
      <button
        aria-label="Предыдущее совпадение"
        className="icon-btn"
        disabled={matches.length < 2}
        onClick={() => step(-1)}
        type="button"
      >
        ↑
      </button>
      <button
        aria-label="Следующее совпадение"
        className="icon-btn"
        disabled={matches.length < 2}
        onClick={() => step(1)}
        type="button"
      >
        ↓
      </button>
      <button
        aria-label="Закрыть поиск"
        className="icon-btn"
        onClick={onClose}
        type="button"
      >
        ✕
      </button>
    </div>
  );
};
