import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Message } from "../../../shared/model.ts";
import { api, errorText, uploadImage } from "../api.ts";
import { compressImage } from "../image.ts";
import { alertMessage, haptic } from "../telegram.ts";

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
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

  const pickPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      return;
    }
    const blob = await compressImage(file);
    setPhoto({ blob, url: URL.createObjectURL(blob) });
  };

  const send = async () => {
    const body = text.trim();
    if (!(body || photo) || sending) {
      return;
    }
    setSending(true);
    try {
      const attachment = photo ? await uploadImage(photo.blob) : null;
      const message = await api<Message>(`/tasks/${taskId}/messages`, {
        method: "POST",
        body: { body, attachment, replyTo: replyTo?.id ?? null },
      });
      haptic.success();
      setText("");
      setPhoto(null);
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
        {photo ? (
          <div className="reply-bar">
            <img
              alt="Фото к отправке"
              className="preview-img"
              src={photo.url}
            />
            <span className="spacer" />
            <button
              aria-label="Убрать фото"
              className="icon-btn"
              onClick={() => setPhoto(null)}
              type="button"
            >
              ✕
            </button>
          </div>
        ) : null}
        <div className="row">
          <button
            aria-label="Прикрепить фото"
            className="icon-btn"
            onClick={() => fileInput.current?.click()}
            type="button"
          >
            📎
          </button>
          <input
            accept="image/*"
            hidden
            onChange={pickPhoto}
            ref={fileInput}
            type="file"
          />
          <textarea
            aria-label="Сообщение"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Сообщение…"
            ref={input}
            rows={1}
            value={text}
          />
          <button
            aria-label="Отправить"
            className="icon-btn send"
            disabled={sending || !(text.trim() || photo)}
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
