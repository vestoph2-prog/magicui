export const ROLES = ["admin", "manager", "client", "guest"] as const;
export type Role = (typeof ROLES)[number];

export const DEAL_STAGES = [
  "lead",
  "negotiation",
  "contract",
  "in_work",
  "done",
  "lost",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

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

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  client: "Заказчик",
  guest: "Без доступа",
};

export const STAGE_LABELS: Record<DealStage, string> = {
  lead: "Заявка",
  negotiation: "Переговоры",
  contract: "Договор",
  in_work: "В работе",
  done: "Завершена",
  lost: "Отказ",
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
  clientName: string;
  clientContact: string;
  amount: number;
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
  objectId: number;
  objectName: string;
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
  commentsCount: number;
};

export type Comment = {
  id: number;
  taskId: number;
  authorId: number;
  authorName: string;
  body: string;
  createdAt: string;
};

export type Activity = {
  id: number;
  taskId: number;
  actorName: string;
  text: string;
  createdAt: string;
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
  pipelineAmount: number;
};

export type TaskInput = {
  dealId: number;
  title: string;
  description?: string;
  priority?: Priority;
  dueDate?: string | null;
  assigneeId?: number | null;
};

export type TaskPatch = Partial<
  Pick<
    Task,
    "title" | "description" | "status" | "priority" | "dueDate" | "assigneeId"
  >
>;

export type DealInput = {
  objectId: number;
  title: string;
  clientName?: string;
  clientContact?: string;
  amount?: number;
  stage?: DealStage;
  notes?: string;
};

export type ObjectInput = {
  name: string;
  address?: string;
  description?: string;
  archived?: boolean;
};

export const isStaff = (role: Role): boolean =>
  role === "admin" || role === "manager";

export const isOpenStatus = (status: TaskStatus): boolean =>
  status !== "done" && status !== "canceled";

export const displayName = (u: {
  firstName: string;
  lastName: string | null;
}): string => (u.lastName ? `${u.firstName} ${u.lastName}` : u.firstName);
