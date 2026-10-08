import { useEffect } from "react";
import { type InboxItem, STATUS_LABELS } from "../../../shared/model.ts";
import { useApi } from "../api.ts";
import { Empty, ErrorBox, go, PageTitle } from "../ui.tsx";

const REFRESH_MS = 5000;

const timeOrDate = (iso: string): string => {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(
    "ru-RU",
    sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "2-digit" }
  );
};

const preview = (item: InboxItem): string => {
  const text = item.lastBody || (item.lastHasAttachment ? "📷 Фото" : "");
  return `${item.lastAuthor}: ${text}`;
};

export const ChatsScreen = () => {
  const inbox = useApi<InboxItem[]>("/inbox");
  const { reload } = inbox;

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        reload();
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  return (
    <>
      <PageTitle title="Чаты по задачам" />
      <ErrorBox message={inbox.error} />
      <div className="stack">
        {inbox.data?.map((item) => (
          <button
            className="card inbox-item"
            key={item.taskId}
            onClick={go(`/tasks/${item.taskId}`)}
            type="button"
          >
            <b className="card-title" style={{ margin: 0 }}>
              {item.title}
            </b>
            <span className="hint">{timeOrDate(item.lastAt)}</span>
            <span className="hint" style={{ fontSize: 12 }}>
              {item.objectName} · {STATUS_LABELS[item.status]}
            </span>
            <span />
            <span className="last">{preview(item)}</span>
            {item.unreadCount ? (
              <span className="unread">{item.unreadCount}</span>
            ) : (
              <span />
            )}
          </button>
        ))}
      </div>
      {inbox.data && inbox.data.length === 0 ? (
        <Empty>
          Переписки пока нет. Откройте любую задачу и напишите сообщение —
          диалог появится здесь.
        </Empty>
      ) : null}
    </>
  );
};
