import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import {
  type Deal,
  displayName,
  isStaff,
  PRIORITIES,
  PRIORITY_LABELS,
  type Priority,
  type Task,
  type User,
} from "../../../shared/model.ts";
import { api, useApi } from "../api.ts";
import { navigate } from "../router.ts";
import { haptic } from "../telegram.ts";
import {
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageTitle,
  useSession,
} from "../ui.tsx";

type FormState = {
  dealId: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
  assigneeId: string;
};

const fromTask = (t: Task): FormState => ({
  dealId: String(t.dealId),
  title: t.title,
  description: t.description,
  priority: t.priority,
  dueDate: t.dueDate ?? "",
  assigneeId: t.assigneeId ? String(t.assigneeId) : "",
});

/** Deals grouped by object for the <optgroup> picker. */
const groupByObject = (deals: Deal[]) => {
  const groups = new Map<string, Deal[]>();
  for (const d of deals) {
    const list = groups.get(d.objectName) ?? [];
    list.push(d);
    groups.set(d.objectName, list);
  }
  return [...groups.entries()];
};

const NoDeals = ({ canCreate }: { canCreate: boolean }) => (
  <Empty>
    Сначала нужна сделка: задачи всегда привязаны к сделке на объекте.
    {canCreate ? (
      <p>
        <button
          className="btn"
          onClick={() => navigate("/deals/new")}
          type="button"
        >
          Создать сделку
        </button>
      </p>
    ) : null}
  </Empty>
);

export const TaskFormScreen = ({
  id,
  dealId,
}: {
  id?: number;
  dealId?: string;
}) => {
  const user = useSession();
  const staff = isStaff(user.role);
  const existing = useApi<{ task: Task }>(id ? `/tasks/${id}` : null);
  const deals = useApi<Deal[]>("/deals");
  const users = useApi<User[]>(staff ? "/users" : null);
  const [form, setForm] = useState<FormState>({
    dealId: dealId ?? "",
    title: "",
    description: "",
    priority: "normal",
    dueDate: "",
    assigneeId: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing.data) {
      setForm(fromTask(existing.data.task));
    }
  }, [existing.data]);

  useEffect(() => {
    const only = deals.data?.length === 1 ? deals.data[0] : undefined;
    if (only && !form.dealId) {
      setForm((f) => ({ ...f, dealId: String(only.id) }));
    }
  }, [deals.data, form.dealId]);

  if ((id && !existing.data) || !deals.data) {
    return existing.error || deals.error ? (
      <ErrorBox message={existing.error ?? deals.error} />
    ) : (
      <Loading />
    );
  }

  if (deals.data.length === 0) {
    return <NoDeals canCreate={staff} />;
  }

  const set =
    <K extends keyof FormState>(key: K) =>
    (
      e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
    ) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      dealId: Number(form.dealId),
      title: form.title,
      description: form.description,
      priority: form.priority,
      dueDate: form.dueDate || null,
      ...(staff
        ? { assigneeId: form.assigneeId ? Number(form.assigneeId) : null }
        : {}),
    };
    try {
      const task = await api<Task>(id ? `/tasks/${id}` : "/tasks", {
        method: id ? "PATCH" : "POST",
        body,
      });
      haptic.success();
      navigate(`/tasks/${task.id}`, true);
    } catch (err) {
      haptic.error();
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const staffUsers = (users.data ?? []).filter((u) => isStaff(u.role));

  return (
    <form className="form" onSubmit={submit}>
      <PageTitle title={id ? "Редактирование задачи" : "Новая задача"} />
      <ErrorBox message={error} />
      <Field label="Сделка / объект">
        <select
          disabled={Boolean(id)}
          onChange={set("dealId")}
          required
          value={form.dealId}
        >
          <option disabled value="">
            Выберите сделку
          </option>
          {groupByObject(deals.data).map(([objectName, list]) => (
            <optgroup key={objectName} label={objectName}>
              {list.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="Что нужно сделать">
        <input
          maxLength={200}
          onChange={set("title")}
          placeholder="Например: подготовить смету на кровлю"
          required
          value={form.title}
        />
      </Field>
      <Field label="Подробности">
        <textarea
          maxLength={5000}
          onChange={set("description")}
          placeholder="Детали, требования, ссылки"
          value={form.description}
        />
      </Field>
      <div className="row" style={{ alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <Field label="Приоритет">
            <select onChange={set("priority")} value={form.priority}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <Field label="Срок">
            <input onChange={set("dueDate")} type="date" value={form.dueDate} />
          </Field>
        </div>
      </div>
      {staff ? (
        <Field label="Исполнитель">
          <select onChange={set("assigneeId")} value={form.assigneeId}>
            <option value="">— не назначен —</option>
            {staffUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {displayName(u)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <button className="btn block" disabled={saving} type="submit">
        {id ? "Сохранить" : "Создать задачу"}
      </button>
    </form>
  );
};
