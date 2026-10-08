import { createContext, type ReactNode, useContext } from "react";
import {
  type CrmObject,
  type Deal,
  type DealStage,
  isOpenStatus,
  PRIORITY_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  type Task,
  type TaskStatus,
  type User,
} from "../../shared/model.ts";
import { formatDue, formatMoney, isOverdue } from "./format.ts";
import { navigate } from "./router.ts";
import { haptic } from "./telegram.ts";

export const SessionContext = createContext<User | null>(null);

export const useSession = (): User => {
  const user = useContext(SessionContext);
  if (!user) {
    throw new Error("useSession outside SessionContext");
  }
  return user;
};

export const go = (path: string) => () => {
  haptic.tap();
  navigate(path);
};

export const PageTitle = ({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) => (
  <div className="page-title">
    <h1>{title}</h1>
    {action}
  </div>
);

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h3 className="section-title">{children}</h3>
);

export const ErrorBox = ({ message }: { message: string | null }) =>
  message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;

export const Loading = () => <div className="center">Загрузка…</div>;

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="empty">{children}</div>
);

export const Fab = ({ to, label }: { to: string; label: string }) => (
  <button aria-label={label} className="fab" onClick={go(to)} type="button">
    +
  </button>
);

export type ChipOption<T extends string> = {
  value: T;
  label: string;
  count?: number;
};

export const Chips = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) => (
  <div className="chips">
    {options.map((o) => (
      <button
        aria-pressed={o.value === value}
        className="chip"
        key={o.value}
        onClick={() => {
          haptic.select();
          onChange(o.value);
        }}
        type="button"
      >
        {o.label}
        {o.count === undefined ? null : (
          <span className="count">{o.count}</span>
        )}
      </button>
    ))}
  </div>
);

export const StatusBadge = ({ status }: { status: TaskStatus }) => (
  <span className={`badge s-${status}`}>{STATUS_LABELS[status]}</span>
);

export const StageBadge = ({ stage }: { stage: DealStage }) => (
  <span className={`badge st-${stage}`}>{STAGE_LABELS[stage]}</span>
);

export const DueDate = ({ task }: { task: Task }) => {
  if (!task.dueDate) {
    return null;
  }
  const overdue = isOpenStatus(task.status) && isOverdue(task.dueDate);
  return (
    <span className={overdue ? "overdue" : undefined}>
      {overdue ? "⚠️ просрочено " : "📅 до "}
      {formatDue(task.dueDate)}
    </span>
  );
};

export const TaskCard = ({
  task,
  showDeal = true,
}: {
  task: Task;
  showDeal?: boolean;
}) => {
  const classes = [
    "card",
    `priority-${task.priority}`,
    isOpenStatus(task.status) ? "" : "is-closed",
  ];
  return (
    <button
      className={classes.join(" ")}
      onClick={go(`/tasks/${task.id}`)}
      type="button"
    >
      <div className="row">
        <StatusBadge status={task.status} />
        {task.priority === "urgent" || task.priority === "high" ? (
          <span className="badge">{PRIORITY_LABELS[task.priority]}</span>
        ) : null}
        <span className="spacer" />
        <span className="hint">#{task.id}</span>
      </div>
      <p className="card-title" style={{ marginTop: 6 }}>
        {task.title}
      </p>
      <div className="card-meta">
        {showDeal ? (
          <span>
            🏗 {task.objectName} · {task.dealTitle}
          </span>
        ) : null}
        <DueDate task={task} />
        {task.assigneeName ? <span>👤 {task.assigneeName}</span> : null}
        {task.commentsCount ? <span>💬 {task.commentsCount}</span> : null}
      </div>
    </button>
  );
};

export const DealCard = ({
  deal,
  showObject = true,
}: {
  deal: Deal;
  showObject?: boolean;
}) => (
  <button className="card" onClick={go(`/deals/${deal.id}`)} type="button">
    <div className="row">
      <StageBadge stage={deal.stage} />
      <span className="spacer" />
      {deal.amount ? <b>{formatMoney(deal.amount)}</b> : null}
    </div>
    <p className="card-title" style={{ marginTop: 6 }}>
      {deal.title}
    </p>
    <div className="card-meta">
      {showObject ? <span>🏗 {deal.objectName}</span> : null}
      {deal.clientName ? <span>🤝 {deal.clientName}</span> : null}
      <span>
        ✅ задач: {deal.openTasksCount} открыто / {deal.tasksCount}
      </span>
    </div>
  </button>
);

export const ObjectCard = ({ object }: { object: CrmObject }) => (
  <button
    className={object.archived ? "card is-closed" : "card"}
    onClick={go(`/objects/${object.id}`)}
    type="button"
  >
    <p className="card-title">
      {object.name}
      {object.archived ? " (архив)" : ""}
    </p>
    {object.address ? <div className="hint">📍 {object.address}</div> : null}
    <div className="card-meta">
      <span>💼 сделок: {object.dealsCount}</span>
      <span>✅ открытых задач: {object.openTasksCount}</span>
    </div>
  </button>
);

export const Field = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);
