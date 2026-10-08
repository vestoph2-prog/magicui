import { useEffect, useState } from "react";
import {
  type Dashboard,
  STATUS_LABELS,
  TASK_STATUSES,
  type Task,
  type TaskStatus,
} from "../../../shared/model.ts";
import { query, useApi } from "../api.ts";
import { navigate, type Route } from "../router.ts";
import { haptic } from "../telegram.ts";
import {
  type ChipOption,
  Chips,
  Empty,
  ErrorBox,
  Fab,
  PageTitle,
  TaskCard,
  useSession,
} from "../ui.tsx";

type StatusFilter = TaskStatus | "open" | "all";

const SEARCH_DELAY_MS = 300;

const setParam = (route: Route, key: string, value: string) => {
  const params = new URLSearchParams(route.params);
  if (value) {
    params.set(key, value);
  } else {
    params.delete(key);
  }
  const s = params.toString();
  navigate(`/tasks${s ? `?${s}` : ""}`, true);
};

const Stat = ({
  label,
  value,
  danger,
  onClick,
}: {
  label: string;
  value: number;
  danger?: boolean;
  onClick: () => void;
}) => (
  <button
    className={danger && value > 0 ? "stat danger" : "stat"}
    onClick={() => {
      haptic.select();
      onClick();
    }}
    type="button"
  >
    <b>{value}</b>
    <span>{label}</span>
  </button>
);

export const TasksScreen = ({ route }: { route: Route }) => {
  const user = useSession();
  const status = (route.params.get("status") ?? "open") as StatusFilter;
  const mine = route.params.get("mine") === "1";
  const q = route.params.get("q") ?? "";
  const [search, setSearch] = useState(q);

  useEffect(() => {
    if (search === q) {
      return;
    }
    const timer = setTimeout(
      () => setParam(route, "q", search.trim()),
      SEARCH_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [search, q, route]);

  const tasks = useApi<Task[]>(
    `/tasks${query({
      status: status === "all" ? undefined : status,
      mine: mine ? 1 : undefined,
      q: q || undefined,
    })}`
  );
  const stats = useApi<Dashboard>("/dashboard");
  const counts = stats.data?.tasksByStatus;

  const options: ChipOption<StatusFilter>[] = [
    { value: "open", label: "Открытые" },
    ...TASK_STATUSES.map((s) => ({
      value: s,
      label: STATUS_LABELS[s],
      count: counts?.[s],
    })),
    { value: "all", label: "Все" },
  ];

  const mineLabel = user.role === "client" ? "Мои заявки" : "Мне назначено";

  return (
    <>
      <PageTitle title="Задачи" />
      {stats.data ? (
        <div className="stats">
          <Stat
            label={mineLabel}
            onClick={() => navigate("/tasks?status=open&mine=1", true)}
            value={stats.data.myOpen}
          />
          <Stat
            danger
            label="Просрочено"
            onClick={() => navigate("/tasks?status=open", true)}
            value={stats.data.overdue}
          />
          <Stat
            label="На проверке"
            onClick={() => navigate("/tasks?status=review", true)}
            value={stats.data.tasksByStatus.review}
          />
        </div>
      ) : null}
      <input
        aria-label="Поиск задач"
        className="search"
        onChange={(e) => setSearch(e.target.value)}
        placeholder="🔍 Поиск по задачам, сделкам, объектам"
        type="search"
        value={search}
      />
      <Chips
        onChange={(v) => setParam(route, "status", v === "open" ? "" : v)}
        options={options}
        value={status}
      />
      <div className="chips">
        <button
          aria-pressed={mine}
          className="chip"
          onClick={() => {
            haptic.select();
            setParam(route, "mine", mine ? "" : "1");
          }}
          type="button"
        >
          👤 {mineLabel}
        </button>
      </div>
      <ErrorBox message={tasks.error} />
      <div className="stack">
        {tasks.data?.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
      </div>
      {tasks.data && tasks.data.length === 0 ? (
        <Empty>Задач нет 🎉</Empty>
      ) : null}
      <Fab label="Новая задача" to="/tasks/new" />
    </>
  );
};
