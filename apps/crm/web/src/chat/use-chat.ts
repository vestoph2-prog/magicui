import { useCallback, useEffect, useRef, useState } from "react";
import type { Activity, ChatUpdate, Message } from "../../../shared/model.ts";
import { api } from "../api.ts";

const POLL_MS = 3000;

export type Chat = {
  messages: Message[];
  activity: Activity[];
  loaded: boolean;
  append: (message: Message) => void;
  remove: (id: number) => void;
  refresh: () => void;
};

const mergeById = <T extends { id: number }>(list: T[], extra: T[]): T[] => {
  if (!extra.length) {
    return list;
  }
  const seen = new Set(list.map((x) => x.id));
  return [...list, ...extra.filter((x) => !seen.has(x.id))];
};

/**
 * Keeps a task chat in sync by polling for messages newer than the last one.
 * Polling (not websockets) survives any proxy and Telegram's webview sleeping.
 * `onTaskChanged` fires when someone else edits the task card.
 */
export const useChat = (taskId: number, onTaskChanged: () => void): Chat => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const cursor = useRef({ message: 0, activity: 0, updatedAt: "" });
  const onChanged = useRef(onTaskChanged);
  onChanged.current = onTaskChanged;

  const load = useCallback(
    (after: number, afterActivity: number) =>
      api<ChatUpdate>(
        `/tasks/${taskId}/chat?after=${after}&afterActivity=${afterActivity}`
      ),
    [taskId]
  );

  const fetchNew = useCallback(async () => {
    const c = cursor.current;
    let update = await load(c.message, c.activity);
    const changed = c.updatedAt !== "" && c.updatedAt !== update.taskUpdatedAt;
    if (changed) {
      // Something else changed (deleted message, album photo, task card):
      // reload the whole chat rather than diffing.
      update = await load(0, 0);
      onChanged.current();
    }
    c.message = update.messages.at(-1)?.id ?? c.message;
    c.activity = update.activity.at(-1)?.id ?? c.activity;
    c.updatedAt = update.taskUpdatedAt;
    setMessages((list) =>
      changed ? update.messages : mergeById(list, update.messages)
    );
    setActivity((list) =>
      changed ? update.activity : mergeById(list, update.activity)
    );
    setLoaded(true);
  }, [load]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        await fetchNew().catch(() => null);
      }
      if (!stopped) {
        timer = setTimeout(tick, POLL_MS);
      }
    };
    tick().catch(() => null);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        fetchNew().catch(() => null);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchNew]);

  const append = useCallback((message: Message) => {
    setMessages((list) => mergeById(list, [message]));
  }, []);

  const remove = useCallback((id: number) => {
    setMessages((list) => list.filter((m) => m.id !== id));
  }, []);

  const refresh = useCallback(() => {
    fetchNew().catch(() => null);
  }, [fetchNew]);

  return { messages, activity, loaded, append, remove, refresh };
};
