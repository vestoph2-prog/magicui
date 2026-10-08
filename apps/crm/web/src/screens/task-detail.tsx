import { useEffect, useRef, useState } from "react";
import {
  displayName,
  isStaff,
  KIND_LABELS,
  type Message,
  PRIORITY_LABELS,
  SERVICE_ICONS,
  type Task,
  type TaskPatch,
  type TaskStatus,
  type User,
} from "../../../shared/model.ts";
import { api, errorText, useApi } from "../api.ts";
import { Composer } from "../chat/composer.tsx";
import { Gallery } from "../chat/photos.tsx";
import { Timeline } from "../chat/timeline.tsx";
import { useChat } from "../chat/use-chat.ts";
import { formatDateTime } from "../format.ts";
import { goBack } from "../router.ts";
import { alertMessage, confirmAction, haptic } from "../telegram.ts";
import {
  DueDate,
  ErrorBox,
  go,
  Loading,
  StatusBadge,
  useSession,
} from "../ui.tsx";

type Action = {
  label: string;
  patch: TaskPatch;
  tone?: "secondary" | "danger";
};

const staffActions = (task: Task, user: User): Action[] => {
  const byStatus: Record<TaskStatus, Action[]> = {
    new: [
      {
        label: "▶️ Взять в работу",
        patch: {
          status: "in_progress",
          ...(task.assigneeId ? {} : { assigneeId: user.id }),
        },
      },
    ],
    in_progress: [{ label: "👀 На проверку", patch: { status: "review" } }],
    review: [
      { label: "✅ Готово", patch: { status: "done" } },
      {
        label: "↩️ В работу",
        patch: { status: "in_progress" },
        tone: "secondary",
      },
    ],
    done: [
      {
        label: "🔄 Открыть заново",
        patch: { status: "in_progress" },
        tone: "secondary",
      },
    ],
    canceled: [
      {
        label: "🔄 Открыть заново",
        patch: { status: "new" },
        tone: "secondary",
      },
    ],
  };
  return byStatus[task.status];
};

const clientActions = (task: Task, user: User): Action[] => {
  if (task.status === "review") {
    return [
      { label: "✅ Принять работу", patch: { status: "done" } },
      {
        label: "↩️ На доработку",
        patch: { status: "in_progress" },
        tone: "secondary",
      },
    ];
  }
  if (task.status === "new" && task.createdBy === user.id) {
    return [
      {
        label: "Отменить заявку",
        patch: { status: "canceled" },
        tone: "danger",
      },
    ];
  }
  return [];
};

const AssigneePicker = ({
  task,
  onChange,
}: {
  task: Task;
  onChange: (patch: TaskPatch) => void;
}) => {
  const users = useApi<User[]>("/users");
  const staff = (users.data ?? []).filter((u) => isStaff(u.role));
  return (
    <select
      aria-label="Исполнитель"
      className="inline-select"
      onChange={(e) =>
        onChange({
          assigneeId: e.target.value ? Number(e.target.value) : null,
        })
      }
      value={task.assigneeId ?? ""}
    >
      <option value="">— не назначен —</option>
      {staff.map((u) => (
        <option key={u.id} value={u.id}>
          {displayName(u)}
        </option>
      ))}
    </select>
  );
};

const TaskDetails = ({
  task,
  onPatch,
}: {
  task: Task;
  onPatch: (patch: TaskPatch) => void;
}) => {
  const user = useSession();
  const staff = isStaff(user.role);
  const canEdit =
    staff || (task.createdBy === user.id && task.status === "new");

  const remove = async () => {
    if (!(await confirmAction(`Удалить задачу «${task.title}» и её чат?`))) {
      return;
    }
    await api(`/tasks/${task.id}`, { method: "DELETE" });
    haptic.success();
    goBack("/tasks");
  };

  return (
    <>
      {task.description ? (
        <p className="description">{task.description}</p>
      ) : null}
      <dl className="props">
        <dt>Объект</dt>
        <dd>
          <button
            className="link-btn"
            onClick={go(`/objects/${task.objectId}`)}
            style={{ padding: 0, textAlign: "left" }}
            type="button"
          >
            {task.objectName}
          </button>
          {task.objectAddress ? (
            <div className="hint">📍 {task.objectAddress}</div>
          ) : null}
        </dd>
        <dt>Сделка</dt>
        <dd>
          <button
            className="link-btn"
            onClick={go(`/deals/${task.dealId}`)}
            style={{ padding: 0, textAlign: "left" }}
            type="button"
          >
            {SERVICE_ICONS[task.service]} {task.dealTitle}
          </button>
        </dd>
        <dt>Срок</dt>
        <dd>{task.dueDate ? <DueDate task={task} /> : "без срока"}</dd>
        <dt>Исполнитель</dt>
        <dd>
          {staff ? (
            <AssigneePicker onChange={onPatch} task={task} />
          ) : (
            (task.assigneeName ?? "не назначен")
          )}
        </dd>
        <dt>Автор</dt>
        <dd>
          {task.createdByName}, {formatDateTime(task.createdAt)}
        </dd>
      </dl>
      {canEdit ? (
        <div className="actions">
          <button
            className="btn secondary small"
            onClick={go(`/tasks/${task.id}/edit`)}
            type="button"
          >
            ✏️ Редактировать
          </button>
          {staff && task.status !== "canceled" && task.status !== "done" ? (
            <button
              className="btn danger small"
              onClick={() => onPatch({ status: "canceled" })}
              type="button"
            >
              Отменить
            </button>
          ) : null}
          {staff ? (
            <button className="btn danger small" onClick={remove} type="button">
              🗑 Удалить
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
};

const TaskHead = ({
  task,
  onPatch,
  busy,
  photos,
}: {
  task: Task;
  onPatch: (patch: TaskPatch) => void;
  busy: boolean;
  photos: string[];
}) => {
  const user = useSession();
  const [open, setOpen] = useState(false);
  const actions = isStaff(user.role)
    ? staffActions(task, user)
    : clientActions(task, user);

  return (
    <div className="task-head">
      <div className="row">
        <StatusBadge status={task.status} />
        <span className="badge">{KIND_LABELS[task.kind]}</span>
        {task.priority === "normal" ? null : (
          <span className="badge">{PRIORITY_LABELS[task.priority]}</span>
        )}
        <span className="spacer" />
        <span className="hint">#{task.id}</span>
      </div>
      <h2>{task.title}</h2>
      <div className="hint">
        {SERVICE_ICONS[task.service]} {task.objectName} · {task.dealTitle}
        {task.dueDate ? (
          <>
            {" · "}
            <DueDate task={task} />
          </>
        ) : null}
      </div>
      {actions.length ? (
        <div className="actions">
          {actions.map((a) => (
            <button
              className={a.tone ? `btn small ${a.tone}` : "btn small"}
              disabled={busy}
              key={a.label}
              onClick={() => onPatch(a.patch)}
              type="button"
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
      {open ? <TaskDetails onPatch={onPatch} task={task} /> : null}
      {open && photos.length ? (
        <>
          <h3 className="section-title" style={{ margin: "14px 0 6px" }}>
            Фото по задаче · {photos.length}
          </h3>
          <Gallery files={photos} />
        </>
      ) : null}
      <button
        className="toggle"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {open ? "Скрыть детали ▲" : "Детали задачи ▼"}
        {!open && photos.length ? ` · 📷 ${photos.length}` : ""}
      </button>
    </div>
  );
};

const NEAR_BOTTOM_PX = 240;

const scrollToBottom = (smooth: boolean) =>
  window.scrollTo({
    top: document.documentElement.scrollHeight,
    behavior: smooth ? "smooth" : "auto",
  });

/** Sticks to the bottom like a messenger, unless the user scrolled up. */
const useStickToBottom = (count: number, loaded: boolean) => {
  const first = useRef(true);
  useEffect(() => {
    if (!loaded || count === 0) {
      return;
    }
    const distance =
      document.documentElement.scrollHeight -
      window.scrollY -
      window.innerHeight;
    if (first.current || distance < NEAR_BOTTOM_PX) {
      scrollToBottom(!first.current);
      first.current = false;
    }
  }, [count, loaded]);
};

export const TaskDetailScreen = ({ id }: { id: number }) => {
  const user = useSession();
  const task = useApi<Task>(`/tasks/${id}`);
  const chat = useChat(id, task.reload);
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  useStickToBottom(chat.messages.length + chat.activity.length, chat.loaded);

  if (!task.data) {
    return task.error ? <ErrorBox message={task.error} /> : <Loading />;
  }

  const patch = async (p: TaskPatch) => {
    setBusy(true);
    try {
      task.setData(
        await api<Task>(`/tasks/${id}`, { method: "PATCH", body: p })
      );
      haptic.success();
      chat.refresh();
    } catch (e) {
      haptic.error();
      alertMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-screen">
      <TaskHead
        busy={busy}
        onPatch={patch}
        photos={chat.messages.flatMap((m) => m.attachments)}
        task={task.data}
      />
      <Timeline
        activity={chat.activity}
        me={user}
        messages={chat.messages}
        onDeleted={chat.remove}
        onReply={setReplyTo}
      />
      {chat.loaded && chat.messages.length === 0 ? (
        <div className="system">
          Здесь можно обсуждать задачу: уточнения, фото с объекта, сроки выезда.
          Участники получат уведомление в Telegram.
        </div>
      ) : null}
      <Composer
        onCancelReply={() => setReplyTo(null)}
        onSent={(m) => {
          chat.append(m);
          setTimeout(() => scrollToBottom(true), 50);
        }}
        replyTo={replyTo}
        taskId={id}
      />
    </div>
  );
};
