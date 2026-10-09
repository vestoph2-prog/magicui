import {
  type ClipboardEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Message } from "../../../shared/model.ts";
import { api, errorText } from "../api.ts";
import { alertMessage, haptic } from "../telegram.ts";
import { AttachButton, DraftPreviews, usePhotoDraft } from "./photos.tsx";

const DRAFT_PREFIX = "crm-draft-";

const loadDraft = (taskId: number): string => {
  try {
    return localStorage.getItem(`${DRAFT_PREFIX}${taskId}`) ?? "";
  } catch {
    return "";
  }
};

const saveDraft = (taskId: number, text: string) => {
  try {
    if (text) {
      localStorage.setItem(`${DRAFT_PREFIX}${taskId}`, text);
    } else {
      localStorage.removeItem(`${DRAFT_PREFIX}${taskId}`);
    }
  } catch {
    // drafts are a convenience — ignore storage failures
  }
};

type Props = {
  taskId: number;
  replyTo: Message | null;
  onCancelReply: () => void;
  onSent: (message: Message) => void;
};

export const Composer = ({ taskId, replyTo, onCancelReply, onSent }: Props) => {
  const [text, setText] = useState(() => loadDraft(taskId));
  const draft = usePhotoDraft();
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const hasPhotos = draft.photos.length > 0;

  useEffect(() => saveDraft(taskId, text), [taskId, text]);

  useEffect(() => {
    if (replyTo) {
      input.current?.focus();
    }
  }, [replyTo]);

  // Auto-grow the textarea up to its CSS max-height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize on text change
  useEffect(() => {
    const el = input.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [text]);

  // Screenshots pasted from the clipboard become attachments.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      draft.addFiles(files).catch(() => null);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!(body || hasPhotos) || sending || draft.preparing) {
      return;
    }
    setSending(true);
    try {
      const attachments = await draft.uploadAll();
      const message = await api<Message>(`/tasks/${taskId}/messages`, {
        method: "POST",
        body: { body, attachments, replyTo: replyTo?.id ?? null },
      });
      haptic.success();
      setText("");
      draft.clear();
      onCancelReply();
      onSent(message);
    } catch (err) {
      haptic.error();
      alertMessage(errorText(err));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter = new line (mobile habit); Ctrl/Cmd+Enter sends from a desktop.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send().catch(() => null);
    }
  };

  return (
    <div className="composer">
      <div className="composer-inner">
        {replyTo ? (
          <div className="reply-bar">
            <div className="quote">
              <b>↩️ {replyTo.authorName}</b>
              <span>{replyTo.body || "📷 Фото"}</span>
            </div>
            <button
              aria-label="Отменить ответ"
              className="icon-btn"
              onClick={onCancelReply}
              type="button"
            >
              ✕
            </button>
          </div>
        ) : null}
        <DraftPreviews draft={draft} />
        <div className="row">
          <AttachButton draft={draft} />
          <textarea
            aria-label="Сообщение"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="Сообщение…"
            ref={input}
            rows={1}
            value={text}
          />
          <button
            aria-label="Отправить"
            className="icon-btn send"
            disabled={sending || draft.preparing || !(text.trim() || hasPhotos)}
            onClick={send}
            type="button"
          >
            {sending ? "…" : "➤"}
          </button>
        </div>
      </div>
    </div>
  );
};
