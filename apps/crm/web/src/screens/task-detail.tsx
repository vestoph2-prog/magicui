import { useState } from "react";
import {
  type Activity,
  type Comment,
  displayName,
  isStaff,
  PRIORITY_LABELS,
  type Task,
  type TaskPatch,
  type TaskStatus,
  type User,
} from "../../../shared/model.ts";
import { api, useApi } from "../api.ts";
import { formatDateTime } from "../format.ts";
import { goBack } from "../router.ts";
import { alertMessage, confirmAction, haptic } from "../telegram.ts";
import {
  DueDate,
  ErrorBox,
  go,
  Loading,
  SectionTitle,
  StatusBadge,
  useSession,
} from "../ui.tsx";

type TaskData = { task: Task; comments: Comment[]; activity: Activity[] };

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
        label: "↩️ Вернуть в работу",
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
  const actions = [...byStatus[task.status]];
  if (task.status !== "done" && task.status !== "canceled") {
    actions.push({
      label: "Отменить",
      patch: { status: "canceled" },
      tone: "danger",
    });
  }
  return actions;
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

const Comments = ({
  task,
  comments,
  onPosted,
}: {
  task: Task;
  comments: Comment[];
  onPosted: (comments: Comment[]) => void;
}) => {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const body = text.trim();
    if (!body) {
      return;
    }
    setSending(true);
    try {
      const updated = await api<Comment[]>(`/tasks/${task.id}/comments`, {
        method: "POST",
        body: { body },
      });
      setText("");
      haptic.success();
      onPosted(updated);
    } catch (e) {
      haptic.error();
      alertMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <SectionTitle>Комментарии</SectionTitle>
      <div className="stack">
        {comments.map((c) => (
          <article className="comment" key={c.id}>
            <header>
              <b>{c.authorName}</b>
              <span className="hint">{formatDateTime(c.createdAt)}</span>
            </header>
            <p>{c.body}</p>
          </article>
        ))}
        {comments.length === 0 ? (
          <div className="hint" style={{ padding: "0 6px" }}>
            Пока нет комментариев
          </div>
        ) : null}
      </div>
      <div className="comment-form">
        <textarea
          aria-label="Комментарий"
          onChange={(e) => setText(e.target.value)}
          placeholder="Написать комментарий…"
          rows={1}
          value={text}
        />
        <button
          className="btn"
          disabled={sending || !text.trim()}
          onClick={send}
          type="button"
        >
          ➤
        </button>
      </div>
    </>
  );
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
      onChange={(e) =>
        onChange({
          assigneeId: e.target.value ? Number(e.target.value) : null,
        })
      }
      style={{
        background: "none",
        border: 0,
        padding: 0,
        color: "var(--link)",
      }}
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

export const TaskDetailScreen = ({ id }: { id: number }) => {
  const user = useSession();
  const { data, error, setData, reload } = useApi<TaskData>(`/tasks/${id}`);
  const [busy, setBusy] = useState(false);

  if (!data) {
    return error ? <ErrorBox message={error} /> : <Loading />;
  }
  const { task } = data;
  const staff = isStaff(user.role);
  const actions = staff ? staffActions(task, user) : clientActions(task, user);
  const canEdit =
    staff || (task.createdBy === user.id && task.status === "new");

  const apply = async (patch: TaskPatch) => {
    setBusy(true);
    try {
      await api<Task>(`/tasks/${task.id}`, { method: "PATCH", body: patch });
      haptic.success();
      reload();
    } catch (e) {
      haptic.error();
      alertMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirmAction(`Удалить задачу «${task.title}»?`))) {
      return;
    }
    await api(`/tasks/${task.id}`, { method: "DELETE" });
    haptic.success();
    goBack("/tasks");
  };

  return (
    <>
      <div className="detail">
        <div className="row">
          <StatusBadge status={task.status} />
          <span className="badge">{PRIORITY_LABELS[task.priority]}</span>
          <span className="spacer" />
          <span className="hint">#{task.id}</span>
        </div>
        <h2 style={{ marginTop: 10 }}>{task.title}</h2>
        {task.description ? (
          <p className="description">{task.description}</p>
        ) : null}
        <dl className="props">
          <dt>Объект</dt>
          <dd>
            <button
              className="link-btn"
              onClick={go(`/objects/${task.objectId}`)}
              style={{ padding: 0 }}
              type="button"
            >
              {task.objectName}
            </button>
          </dd>
          <dt>Сделка</dt>
          <dd>
            <button
              className="link-btn"
              onClick={go(`/deals/${task.dealId}`)}
              style={{ padding: 0, textAlign: "left" }}
              type="button"
            >
              {task.dealTitle}
            </button>
          </dd>
          <dt>Срок</dt>
          <dd>{task.dueDate ? <DueDate task={task} /> : "без срока"}</dd>
          <dt>Исполнитель</dt>
          <dd>
            {staff ? (
              <AssigneePicker onChange={apply} task={task} />
            ) : (
              (task.assigneeName ?? "не назначен")
            )}
          </dd>
          <dt>Автор</dt>
          <dd>
            {task.createdByName}, {formatDateTime(task.createdAt)}
          </dd>
        </dl>
        {actions.length ? (
          <div className="actions">
            {actions.map((a) => (
              <button
                className={a.tone ? `btn ${a.tone}` : "btn"}
                disabled={busy}
                key={a.label}
                onClick={() => apply(a.patch)}
                type="button"
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
        {canEdit ? (
          <div className="actions">
            <button
              className="btn secondary small"
              onClick={go(`/tasks/${task.id}/edit`)}
              type="button"
            >
              ✏️ Редактировать
            </button>
            {staff ? (
              <button
                className="btn danger small"
                onClick={remove}
                type="button"
              >
                🗑 Удалить
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Comments
        comments={data.comments}
        onPosted={(comments) => setData({ ...data, comments })}
        task={task}
      />

      <SectionTitle>История</SectionTitle>
      <ul className="timeline">
        {data.activity.map((a) => (
          <li key={a.id}>
            {formatDateTime(a.createdAt)} · <b>{a.actorName}</b>: {a.text}
          </li>
        ))}
      </ul>
    </>
  );
};
