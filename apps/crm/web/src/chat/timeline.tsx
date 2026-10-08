import { useState } from "react";
import type { Activity, Message, User } from "../../../shared/model.ts";
import { api, errorText } from "../api.ts";
import { uploadUrl } from "../image.ts";
import { alertMessage, confirmAction, haptic } from "../telegram.ts";

type Item =
  | { type: "message"; at: string; message: Message }
  | { type: "system"; at: string; activity: Activity };

const dayFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
});
const timeFormat = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

const dayLabel = (iso: string): string => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) {
    return "Сегодня";
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return "Вчера";
  }
  return dayFormat.format(date);
};

const merge = (messages: Message[], activity: Activity[]): Item[] =>
  [
    ...messages.map((m) => ({
      type: "message" as const,
      at: m.createdAt,
      message: m,
    })),
    ...activity.map((a) => ({
      type: "system" as const,
      at: a.createdAt,
      activity: a,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

const scrollToMessage = (id: number) => {
  const el = document.getElementById(`msg-${id}`);
  if (!el) {
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("highlight");
  setTimeout(() => el.classList.remove("highlight"), 1200);
};

type BubbleProps = {
  message: Message;
  me: User;
  selected: boolean;
  onSelect: () => void;
  onReply: () => void;
  onDeleted: () => void;
  onOpenImage: (src: string) => void;
};

const Bubble = ({
  message: m,
  me,
  selected,
  onSelect,
  onReply,
  onDeleted,
  onOpenImage,
}: BubbleProps) => {
  const mine = m.authorId === me.id;
  const canDelete = mine || me.role === "admin";

  const remove = async () => {
    if (!(await confirmAction("Удалить сообщение?"))) {
      return;
    }
    try {
      await api(`/messages/${m.id}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      alertMessage(errorText(e));
    }
  };

  return (
    <div className={mine ? "bubble-row mine" : "bubble-row"}>
      <div className="bubble" id={`msg-${m.id}`}>
        {mine ? null : <div className="author">{m.authorName}</div>}
        {m.replyTo && m.replyBody ? (
          <button
            className="quote"
            onClick={() => scrollToMessage(m.replyTo ?? 0)}
            type="button"
          >
            <b>{m.replyAuthor}</b>
            <span>{m.replyBody}</span>
          </button>
        ) : null}
        {m.attachment ? (
          <button
            className="link-btn"
            onClick={() => onOpenImage(uploadUrl(m.attachment ?? ""))}
            style={{ padding: 0 }}
            type="button"
          >
            <img alt="Вложение к сообщению" src={uploadUrl(m.attachment)} />
          </button>
        ) : null}
        <button
          className="link-btn"
          onClick={() => {
            haptic.select();
            onSelect();
          }}
          style={{ padding: 0, color: "inherit", textAlign: "left" }}
          type="button"
        >
          {m.body ? <div className="text">{m.body}</div> : null}
          <div className="meta">
            {m.source === "telegram" ? "✈️ " : ""}
            {timeFormat.format(new Date(m.createdAt))}
          </div>
        </button>
        {selected ? (
          <div className="bubble-actions">
            <button
              className="btn small secondary"
              onClick={onReply}
              type="button"
            >
              ↩️ Ответить
            </button>
            {m.body ? (
              <button
                className="btn small secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(m.body).catch(() => null);
                  haptic.success();
                  onSelect();
                }}
                type="button"
              >
                📋
              </button>
            ) : null}
            {canDelete ? (
              <button
                className="btn small danger"
                onClick={remove}
                type="button"
              >
                🗑
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const Timeline = ({
  messages,
  activity,
  me,
  onReply,
  onDeleted,
}: {
  messages: Message[];
  activity: Activity[];
  me: User;
  onReply: (message: Message) => void;
  onDeleted: (id: number) => void;
}) => {
  const [selected, setSelected] = useState<number | null>(null);
  const [image, setImage] = useState<string | null>(null);
  let lastDay = "";

  return (
    <div className="chat">
      {merge(messages, activity).map((item) => {
        const day = dayLabel(item.at);
        const separator =
          day === lastDay ? null : (
            <div className="day" key={`day-${item.at}`}>
              {day}
            </div>
          );
        lastDay = day;
        if (item.type === "system") {
          const a = item.activity;
          return [
            separator,
            <div className="system" key={`a-${a.id}`}>
              {a.actorName}: {a.text} ·{" "}
              {timeFormat.format(new Date(a.createdAt))}
            </div>,
          ];
        }
        const m = item.message;
        return [
          separator,
          <Bubble
            key={`m-${m.id}`}
            me={me}
            message={m}
            onDeleted={() => onDeleted(m.id)}
            onOpenImage={setImage}
            onReply={() => {
              setSelected(null);
              onReply(m);
            }}
            onSelect={() => setSelected((s) => (s === m.id ? null : m.id))}
            selected={selected === m.id}
          />,
        ];
      })}
      {image ? (
        <button
          aria-label="Закрыть фото"
          className="lightbox"
          onClick={() => setImage(null)}
          type="button"
        >
          <img alt="Фото из чата" src={image} />
        </button>
      ) : null}
    </div>
  );
};
