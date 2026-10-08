import { useEffect } from "react";
import { isStaff, type User } from "../../shared/model.ts";
import { useApi } from "./api.ts";
import { goBack, navigate, type Route, useRoute } from "./router.ts";
import { ChatsScreen } from "./screens/chats.tsx";
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
  { id: "chats", label: "Чаты", icon: "💬", staffOnly: false },
  { id: "deals", label: "Сделки", icon: "💼", staffOnly: false },
  { id: "objects", label: "Объекты", icon: "🏗", staffOnly: false },
  { id: "team", label: "Команда", icon: "👥", staffOnly: true },
] as const;

const UNREAD_POLL_MS = 15_000;

/** Total unread chat messages for the tab badge. */
const useUnread = (routeKey: string): number => {
  const unread = useApi<{ total: number }>("/unread");
  const { reload } = unread;
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        reload();
      }
    }, UNREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
  // Re-count right after leaving a chat.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on navigation
  useEffect(() => reload(), [routeKey, reload]);
  return unread.data?.total ?? 0;
};

const TabBar = ({
  current,
  user,
  unread,
}: {
  current: string;
  user: User;
  unread: number;
}) => (
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
        <span aria-hidden="true" className="tab-icon">
          {t.icon}
          {t.id === "chats" && unread > 0 ? (
            <span className="unread">{unread > 99 ? "99+" : unread}</span>
          ) : null}
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
    case "chats":
      return <ChatsScreen />;
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

/** Task screens are full-screen chats: the composer replaces the tab bar. */
const isChatRoute = (route: Route): boolean => {
  const [section, id, sub] = route.segments;
  return section === "tasks" && Number(id) > 0 && sub === undefined;
};

const Shell = ({ route, user }: { route: Route; user: User }) => {
  const [section = "tasks"] = route.segments;
  const unread = useUnread(route.segments.join("/"));
  return (
    <SessionContext.Provider value={user}>
      <main className="app">{screenFor(route, user)}</main>
      {isChatRoute(route) ? null : (
        <TabBar current={section} unread={unread} user={user} />
      )}
    </SessionContext.Provider>
  );
};

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
  return <Shell route={route} user={user} />;
};
