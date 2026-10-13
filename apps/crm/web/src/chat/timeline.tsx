import { useState } from "react";
import type { Activity, Message, User } from "../../../shared/model.ts";
import { api, errorText } from "../api.ts";
import { alertMessage, confirmAction, haptic } from "../telegram.ts";
import { Lightbox, PhotoGrid } from "./photos.tsx";

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

export const scrollToMessage = (id: number) => {
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
  onEdit: () => void;
  onOpenImage: (message: Message, index: number) => void;
  match: boolean;
};

const BubbleActions = ({
  message: m,
  me,
  onReply,
  onEdit,
  onDone,
  onDeleted,
}: {
  message: Message;
  me: User;
  onReply: () => void;
  onEdit: () => void;
  onDone: () => void;
  onDeleted: () => void;
}) => {
  const mine = m.authorId === me.id;
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
    <div className="bubble-actions">
      <button className="btn small secondary" onClick={onReply} type="button">
        ↩️ Ответить
      </button>
      {mine && m.body ? (
        <button
          aria-label="Изменить"
          className="btn small secondary"
          onClick={onEdit}
          type="button"
        >
          ✏️
        </button>
      ) : null}
      {m.body ? (
        <button
          aria-label="Копировать"
          className="btn small secondary"
          onClick={() => {
            navigator.clipboard?.writeText(m.body).catch(() => null);
            haptic.success();
            onDone();
          }}
          type="button"
        >
          📋
        </button>
      ) : null}
      {mine || me.role === "admin" ? (
        <button
          aria-label="Удалить"
          className="btn small danger"
          onClick={remove}
          type="button"
        >
          🗑
        </button>
      ) : null}
    </div>
  );
};

const Bubble = ({
  message: m,
  me,
  selected,
  onSelect,
  onReply,
  onDeleted,
  onEdit,
  onOpenImage,
  match,
}: BubbleProps) => {
  const mine = m.authorId === me.id;
  return (
    <div className={mine ? "bubble-row mine" : "bubble-row"}>
      <div className={match ? "bubble match" : "bubble"} id={`msg-${m.id}`}>
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
        {m.attachments.length ? (
          <PhotoGrid files={m.attachments} onOpen={(i) => onOpenImage(m, i)} />
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
            {m.editedAt ? "изменено · " : ""}
            {m.source === "telegram" ? "✈️ " : ""}
            {timeFormat.format(new Date(m.createdAt))}
          </div>
        </button>
        {selected ? (
          <BubbleActions
            me={me}
            message={m}
            onDeleted={onDeleted}
            onDone={onSelect}
            onEdit={onEdit}
            onReply={onReply}
          />
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
  onEdit,
  matches,
}: {
  messages: Message[];
  activity: Activity[];
  me: User;
  onReply: (message: Message) => void;
  onDeleted: (id: number) => void;
  onEdit: (message: Message) => void;
  /** Message ids matching the chat search, highlighted. */
  matches: ReadonlySet<number>;
}) => {
  const [selected, setSelected] = useState<number | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  // All chat photos in order, so the viewer can swipe across messages.
  const photos = messages.flatMap((m) =>
    m.attachments.map((file) => ({ file, message: m }))
  );
  const openImage = (message: Message, index: number) => {
    const file = message.attachments[index];
    setViewer(photos.findIndex((p) => p.file === file));
  };
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
            match={matches.has(m.id)}
            me={me}
            message={m}
            onDeleted={() => onDeleted(m.id)}
            onEdit={() => {
              setSelected(null);
              onEdit(m);
            }}
            onOpenImage={openImage}
            onReply={() => {
              setSelected(null);
              onReply(m);
            }}
            onSelect={() => setSelected((s) => (s === m.id ? null : m.id))}
            selected={selected === m.id}
          />,
        ];
      })}
      {viewer === null ? null : (
        <Lightbox
          caption={(i) => {
            const p = photos[i];
            return p
              ? `· ${p.message.authorName}, ${timeFormat.format(new Date(p.message.createdAt))}`
              : "";
          }}
          files={photos.map((p) => p.file)}
          index={Math.max(0, viewer)}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
};
