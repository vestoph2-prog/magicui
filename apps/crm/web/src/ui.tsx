import { createContext, type ReactNode, useContext } from "react";
import {
  type CrmObject,
  type Deal,
  type DealStage,
  hasCctv,
  hasInternet,
  isOpenStatus,
  KIND_LABELS,
  PRIORITY_LABELS,
  SERVICE_ICONS,
  STAGE_LABELS,
  STATUS_LABELS,
  type Task,
  type TaskStatus,
  type User,
} from "../../shared/model.ts";
import { formatDue, formatMoney, formatVisit, isOverdue } from "./format.ts";
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
        <span className="badge">{KIND_LABELS[task.kind]}</span>
        {task.priority === "urgent" || task.priority === "high" ? (
          <span className="badge">{PRIORITY_LABELS[task.priority]}</span>
        ) : null}
        <span className="spacer" />
        {task.unreadCount ? (
          <span className="unread">{task.unreadCount}</span>
        ) : (
          <span className="hint">#{task.id}</span>
        )}
      </div>
      <p className="card-title" style={{ marginTop: 6 }}>
        {task.title}
      </p>
      <div className="card-meta">
        {showDeal ? (
          <span>
            {SERVICE_ICONS[task.service]} {task.objectName} · {task.dealTitle}
          </span>
        ) : null}
        <DueDate task={task} />
        {task.visitAt && isOpenStatus(task.status) ? (
          <span>🚗 {formatVisit(task.visitAt)}</span>
        ) : null}
        {task.checklistTotal ? (
          <span>
            ☑️ {task.checklistDone}/{task.checklistTotal}
          </span>
        ) : null}
        {task.assigneeName ? <span>👤 {task.assigneeName}</span> : null}
        {task.messagesCount ? <span>💬 {task.messagesCount}</span> : null}
      </div>
    </button>
  );
};

/** Short technical summary: "100 Мбит/с · 8 камер · архив 30 дн." */
export const dealSpecs = (deal: Deal): string[] => {
  const specs: string[] = [];
  if (hasInternet(deal.service) && deal.internetSpeed) {
    specs.push(`${deal.internetSpeed} Мбит/с`);
  }
  if (hasCctv(deal.service) && deal.camerasCount) {
    specs.push(`${deal.camerasCount} камер`);
  }
  if (hasCctv(deal.service) && deal.archiveDays) {
    specs.push(`архив ${deal.archiveDays} дн.`);
  }
  if (deal.monthlyFee) {
    specs.push(`${formatMoney(deal.monthlyFee)}/мес`);
  }
  return specs;
};

const DealSpecs = ({ deal }: { deal: Deal }) => {
  const specs = dealSpecs(deal);
  return specs.length ? <span>⚙️ {specs.join(" · ")}</span> : null;
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
      {SERVICE_ICONS[deal.service]} {deal.title}
    </p>
    <div className="card-meta">
      {showObject ? <span>🏗 {deal.objectName}</span> : null}
      <DealSpecs deal={deal} />
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
      {object.contactName ? <span>👷 {object.contactName}</span> : null}
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
