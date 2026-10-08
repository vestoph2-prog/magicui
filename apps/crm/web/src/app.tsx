import { useEffect } from "react";
import { isStaff, type User } from "../../shared/model.ts";
import { useApi } from "./api.ts";
import { goBack, navigate, type Route, useRoute } from "./router.ts";
import { DealDetailScreen } from "./screens/deal-detail.tsx";
import { DealFormScreen } from "./screens/deal-form.tsx";
import { DealsScreen } from "./screens/deals.tsx";
import {
  ObjectDetailScreen,
  ObjectFormScreen,
  ObjectsScreen,
} from "./screens/objects.tsx";
import { TaskDetailScreen } from "./screens/task-detail.tsx";
import { TaskFormScreen } from "./screens/task-form.tsx";
import { TasksScreen } from "./screens/tasks.tsx";
import { TeamScreen } from "./screens/team.tsx";
import { haptic, insideTelegram, webApp } from "./telegram.ts";
import { ErrorBox, SessionContext } from "./ui.tsx";

const TABS = [
  { id: "tasks", label: "Задачи", icon: "✅", staffOnly: false },
  { id: "deals", label: "Сделки", icon: "💼", staffOnly: false },
  { id: "objects", label: "Объекты", icon: "🏗", staffOnly: false },
  { id: "team", label: "Команда", icon: "👥", staffOnly: true },
] as const;

const TabBar = ({ current, user }: { current: string; user: User }) => (
  <nav className="tabbar">
    {TABS.filter((t) => !t.staffOnly || isStaff(user.role)).map((t) => (
      <button
        aria-current={current === t.id ? "page" : undefined}
        key={t.id}
        onClick={() => {
          haptic.select();
          navigate(`/${t.id}`);
        }}
        type="button"
      >
        <span aria-hidden="true" style={{ fontSize: 22 }}>
          {t.icon}
        </span>
        {t.label}
      </button>
    ))}
  </nav>
);

type Parsed = { id: number; isForm: boolean; editId: number | undefined };

const parseRoute = (route: Route): Parsed => {
  const [, raw, sub] = route.segments;
  const id = Number(raw);
  const isEdit = sub === "edit" && id > 0;
  return {
    id: id > 0 ? id : 0,
    isForm: raw === "new" || isEdit,
    editId: isEdit ? id : undefined,
  };
};

const tasksSection = (route: Route, { id, isForm, editId }: Parsed) => {
  if (isForm) {
    return (
      <TaskFormScreen
        dealId={route.params.get("dealId") ?? undefined}
        id={editId}
      />
    );
  }
  return id ? (
    <TaskDetailScreen id={id} key={id} />
  ) : (
    <TasksScreen route={route} />
  );
};

const dealsSection = (route: Route, { id, isForm, editId }: Parsed) => {
  if (isForm) {
    return (
      <DealFormScreen
        id={editId}
        objectId={route.params.get("objectId") ?? undefined}
      />
    );
  }
  return id ? (
    <DealDetailScreen id={id} key={id} />
  ) : (
    <DealsScreen route={route} />
  );
};

const objectsSection = ({ id, isForm, editId }: Parsed) => {
  if (isForm) {
    return <ObjectFormScreen id={editId} />;
  }
  return id ? <ObjectDetailScreen id={id} key={id} /> : <ObjectsScreen />;
};

const screenFor = (route: Route, user: User) => {
  const parsed = parseRoute(route);
  switch (route.segments[0]) {
    case "deals":
      return dealsSection(route, parsed);
    case "objects":
      return objectsSection(parsed);
    case "team":
      return isStaff(user.role) ? <TeamScreen /> : null;
    default:
      return tasksSection(route, parsed);
  }
};

const useTelegramBackButton = (route: Route) => {
  const [section = "tasks"] = route.segments;
  const nested = route.segments.length > 1;
  useEffect(() => {
    if (!webApp) {
      return;
    }
    const onBack = () => goBack(`/${section}`);
    if (nested) {
      webApp.BackButton.show();
      webApp.BackButton.onClick(onBack);
    } else {
      webApp.BackButton.hide();
    }
    return () => webApp?.BackButton.offClick(onBack);
  }, [nested, section]);
};

const NoAccess = ({ user }: { user: User }) => (
  <div className="center">
    <div>
      <div style={{ fontSize: 48 }}>🔒</div>
      <h2 style={{ color: "var(--text)" }}>Нет доступа</h2>
      <p>
        {user.firstName}, попросите у менеджера ссылку-приглашение и откройте её
        — доступ появится автоматически.
      </p>
      <p className="hint">Ваш Telegram ID: {user.id}</p>
    </div>
  </div>
);

export const App = () => {
  const route = useRoute();
  const me = useApi<{ user: User }>("/me");
  useTelegramBackButton(route);

  if (!me.data) {
    if (!me.error) {
      return <div className="center">Загрузка…</div>;
    }
    return (
      <div className="app">
        <ErrorBox message={me.error} />
        {insideTelegram ? null : (
          <p className="hint">
            Откройте приложение через бота в Telegram. Для локальной разработки
            запустите сервер с DEV_AUTH=1.
          </p>
        )}
      </div>
    );
  }
  const { user } = me.data;
  if (user.role === "guest") {
    return <NoAccess user={user} />;
  }
  const [section = "tasks"] = route.segments;
  return (
    <SessionContext.Provider value={user}>
      <main className="app">{screenFor(route, user)}</main>
      <TabBar current={section} user={user} />
    </SessionContext.Provider>
  );
};
