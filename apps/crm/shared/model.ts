export const ROLES = ["admin", "manager", "client", "guest"] as const;
export type Role = (typeof ROLES)[number];

/** Pipeline of a connection / CCTV installation project. */
export const DEAL_STAGES = [
  "lead",
  "survey",
  "proposal",
  "contract",
  "install",
  "commissioning",
  "done",
  "lost",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const SERVICES = ["internet", "cctv", "both"] as const;
export type Service = (typeof SERVICES)[number];

export const CONNECTION_TYPES = [
  "",
  "fiber",
  "copper",
  "radio",
  "lte",
] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const TASK_STATUSES = [
  "new",
  "in_progress",
  "review",
  "done",
  "canceled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_KINDS = [
  "survey",
  "install",
  "setup",
  "repair",
  "access",
  "docs",
  "other",
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  client: "Заказчик",
  guest: "Без доступа",
};

export const STAGE_LABELS: Record<DealStage, string> = {
  lead: "Заявка",
  survey: "Обследование",
  proposal: "КП / смета",
  contract: "Договор",
  install: "Монтаж",
  commissioning: "Пусконаладка",
  done: "Сдано",
  lost: "Отказ",
};

export const SERVICE_LABELS: Record<Service, string> = {
  internet: "Интернет",
  cctv: "Видеонаблюдение",
  both: "Интернет + видео",
};

export const SERVICE_ICONS: Record<Service, string> = {
  internet: "🌐",
  cctv: "📹",
  both: "🌐📹",
};

export const CONNECTION_LABELS: Record<ConnectionType, string> = {
  "": "не указан",
  fiber: "Оптика (GPON / FTTB)",
  copper: "Медь (Ethernet)",
  radio: "Радиомост",
  lte: "LTE / 4G",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  review: "На проверке",
  done: "Готово",
  canceled: "Отменена",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочно",
};

export const KIND_LABELS: Record<TaskKind, string> = {
  survey: "🔍 Обследование",
  install: "🛠 Монтаж",
  setup: "⚙️ Настройка",
  repair: "🚨 Авария / ремонт",
  access: "🔑 Доступы",
  docs: "📄 Документы",
  other: "💬 Другое",
};

type TaskTemplate = { kind: TaskKind; title: string; checklist?: string[] };

const INTERNET_TASKS: TaskTemplate[] = [
  {
    kind: "install",
    title: "Прокладка кабеля / ввод в здание",
    checklist: [
      "Согласован маршрут трассы",
      "Кабель проложен и закреплён",
      "Кабель промаркирован с обеих сторон",
      "Ввод в помещение загерметизирован",
    ],
  },
  {
    kind: "install",
    title: "Установка оборудования (ONT, роутер, коммутатор)",
    checklist: [
      "Оборудование закреплено, есть вентиляция",
      "Подключено питание (желательно через ИБП)",
      "Записаны серийные номера и MAC",
    ],
  },
  {
    kind: "setup",
    title: "Настройка подключения и Wi-Fi, замер скорости",
    checklist: [
      "Подключение к провайдеру поднято",
      "Wi-Fi: имя сети и пароль согласованы с заказчиком",
      "Пароль администратора роутера сменён",
      "Замер скорости сохранён (скриншот в чат)",
    ],
  },
];

const CCTV_TASKS: TaskTemplate[] = [
  { kind: "docs", title: "Схема расстановки камер" },
  {
    kind: "install",
    title: "Прокладка кабеля и монтаж камер",
    checklist: [
      "Камеры закреплены, углы обзора согласованы",
      "Разъёмы защищены от влаги",
      "Кабели промаркированы",
      "PoE / питание проверено на каждой камере",
    ],
  },
  {
    kind: "install",
    title: "Установка регистратора и жёстких дисков",
    checklist: [
      "HDD установлен и отформатирован",
      "Регистратор подключён к ИБП",
      "Время и часовой пояс синхронизированы",
    ],
  },
  {
    kind: "setup",
    title: "Настройка записи, архива и удалённого просмотра",
    checklist: [
      "Запись по расписанию / движению настроена",
      "Глубина архива соответствует договору",
      "Удалённый просмотр с телефона работает",
      "Пароли по умолчанию сменены",
    ],
  },
  {
    kind: "access",
    title: "Передать доступы заказчику (приложение, пароли)",
    checklist: [
      "Приложение установлено у заказчика",
      "Заказчик показан просмотр архива",
      "Доступы переданы под подпись",
    ],
  },
];

/** Standard work breakdown for each service, created in one tap on a deal. */
export const TASK_TEMPLATES: Record<Service, TaskTemplate[]> = {
  internet: [
    { kind: "survey", title: "Обследование объекта и трассы кабеля" },
    { kind: "docs", title: "КП и смета на подключение" },
    ...INTERNET_TASKS,
    { kind: "docs", title: "Акт выполненных работ, договор на обслуживание" },
  ],
  cctv: [
    { kind: "survey", title: "Обследование: точки установки камер" },
    { kind: "docs", title: "КП и смета на видеонаблюдение" },
    ...CCTV_TASKS,
    { kind: "docs", title: "Акт выполненных работ" },
  ],
  both: [
    { kind: "survey", title: "Обследование объекта: трасса и точки камер" },
    { kind: "docs", title: "КП и смета: интернет + видеонаблюдение" },
    ...INTERNET_TASKS,
    ...CCTV_TASKS,
    { kind: "docs", title: "Акт выполненных работ, договор на обслуживание" },
  ],
};

export type User = {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  role: Role;
  createdAt: string;
};

export type CrmObject = {
  id: number;
  name: string;
  address: string;
  description: string;
  contactName: string;
  contactPhone: string;
  accessNotes: string;
  archived: boolean;
  createdAt: string;
  dealsCount: number;
  openTasksCount: number;
};

export type Deal = {
  id: number;
  objectId: number;
  objectName: string;
  title: string;
  service: Service;
  clientName: string;
  clientContact: string;
  amount: number;
  monthlyFee: number;
  internetSpeed: number;
  connectionType: ConnectionType;
  camerasCount: number;
  archiveDays: number;
  stage: DealStage;
  notes: string;
  createdAt: string;
  updatedAt: string;
  openTasksCount: number;
  tasksCount: number;
};

export type Task = {
  id: number;
  dealId: number;
  dealTitle: string;
  service: Service;
  objectId: number;
  objectName: string;
  objectAddress: string;
  kind: TaskKind;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  createdBy: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  /** Technician visit, ISO UTC timestamp. */
  visitAt: string | null;
  messagesCount: number;
  unreadCount: number;
  checklistTotal: number;
  checklistDone: number;
};

export type ChecklistItem = {
  id: number;
  taskId: number;
  text: string;
  done: boolean;
  doneByName: string | null;
  doneAt: string | null;
};

export type Message = {
  id: number;
  taskId: number;
  authorId: number;
  authorName: string;
  body: string;
  attachments: string[];
  replyTo: number | null;
  replyAuthor: string | null;
  replyBody: string | null;
  source: "app" | "telegram";
  createdAt: string;
};

export type Activity = {
  id: number;
  taskId: number;
  actorName: string;
  text: string;
  createdAt: string;
};

export type ChatUpdate = {
  messages: Message[];
  activity: Activity[];
  taskUpdatedAt: string;
};

export type Photo = {
  file: string;
  messageId: number;
  taskId: number;
  taskTitle: string;
  authorName: string;
  createdAt: string;
};

export const MAX_PHOTOS_PER_MESSAGE = 10;

export type InboxItem = {
  taskId: number;
  title: string;
  status: TaskStatus;
  kind: TaskKind;
  objectName: string;
  dealTitle: string;
  lastAuthor: string;
  lastBody: string;
  lastHasAttachment: boolean;
  lastAt: string;
  unreadCount: number;
};

export type Invite = {
  code: string;
  role: Role;
  link: string;
};

export type Dashboard = {
  tasksByStatus: Record<TaskStatus, number>;
  dealsByStage: Record<DealStage, number>;
  overdue: number;
  myOpen: number;
  urgentOpen: number;
  visitsToday: number;
  pipelineAmount: number;
  monthlyRecurring: number;
};

export type TaskInput = {
  dealId: number;
  kind?: TaskKind;
  title: string;
  description?: string;
  priority?: Priority;
  dueDate?: string | null;
  visitAt?: string | null;
  assigneeId?: number | null;
  checklist?: string[];
};

export type TaskPatch = Partial<
  Pick<
    Task,
    | "kind"
    | "title"
    | "description"
    | "status"
    | "priority"
    | "dueDate"
    | "visitAt"
    | "assigneeId"
  >
>;

export type DealInput = {
  objectId: number;
  title: string;
  service?: Service;
  clientName?: string;
  clientContact?: string;
  amount?: number;
  monthlyFee?: number;
  internetSpeed?: number;
  connectionType?: ConnectionType;
  camerasCount?: number;
  archiveDays?: number;
  stage?: DealStage;
  notes?: string;
};

export type ObjectInput = {
  name: string;
  address?: string;
  description?: string;
  contactName?: string;
  contactPhone?: string;
  accessNotes?: string;
  archived?: boolean;
};

export const hasInternet = (service: Service): boolean =>
  service === "internet" || service === "both";

export const hasCctv = (service: Service): boolean =>
  service === "cctv" || service === "both";

export const isStaff = (role: Role): boolean =>
  role === "admin" || role === "manager";

export const isOpenStatus = (status: TaskStatus): boolean =>
  status !== "done" && status !== "canceled";

export const displayName = (u: {
  firstName: string;
  lastName: string | null;
}): string => (u.lastName ? `${u.firstName} ${u.lastName}` : u.firstName);
