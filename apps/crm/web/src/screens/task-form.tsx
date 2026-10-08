import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import {
  type Deal,
  displayName,
  isStaff,
  KIND_LABELS,
  MAX_PHOTOS_PER_MESSAGE,
  PRIORITIES,
  PRIORITY_LABELS,
  type Priority,
  SERVICE_ICONS,
  TASK_KINDS,
  type Task,
  type TaskKind,
  type User,
} from "../../../shared/model.ts";
import { api, useApi } from "../api.ts";
import {
  AttachButton,
  DraftPreviews,
  type PhotoDraft,
  usePhotoDraft,
} from "../chat/photos.tsx";
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

const toBody = (form: FormState, staff: boolean) => ({
  dealId: Number(form.dealId),
  kind: form.kind,
  title: form.title,
  description: form.description,
  priority: form.priority,
  dueDate: form.dueDate || null,
  ...(staff
    ? { assigneeId: form.assigneeId ? Number(form.assigneeId) : null }
    : {}),
});

const Pending = ({ error }: { error: string | null }) =>
  error ? <ErrorBox message={error} /> : <Loading />;

const KindPicker = ({
  value,
  onChange,
}: {
  value: TaskKind;
  onChange: (kind: TaskKind) => void;
}) => (
  <div className="field">
    <span>Тип задачи</span>
    <div className="chips" style={{ flexWrap: "wrap", margin: 0, padding: 0 }}>
      {TASK_KINDS.map((k) => (
        <button
          aria-pressed={value === k}
          className="chip"
          key={k}
          onClick={() => onChange(k)}
          type="button"
        >
          {KIND_LABELS[k]}
        </button>
      ))}
    </div>
  </div>
);

/** Photos go into the task chat as the first message, visible to everyone. */
const sendPhotos = async (taskId: number, draft: PhotoDraft) => {
  if (!draft.photos.length) {
    return;
  }
  const attachments = await draft.uploadAll();
  await api(`/tasks/${taskId}/messages`, {
    method: "POST",
    body: { body: "", attachments },
  });
  draft.clear();
};

const PhotosField = ({ draft }: { draft: PhotoDraft }) => (
  <div className="field">
    <span>Фото (до {MAX_PHOTOS_PER_MESSAGE})</span>
    <DraftPreviews draft={draft} />
    <AttachButton
      className="btn secondary small"
      draft={draft}
      label={draft.photos.length ? "📷 Добавить ещё" : "📷 Приложить фото"}
    />
  </div>
);

const TITLE_HINTS: Record<TaskKind, string> = {
  survey: "Например: осмотреть щитовую и трассу до 3 этажа",
  install: "Например: смонтировать 4 камеры по периметру",
  setup: "Например: настроить удалённый просмотр с телефона",
  repair: "Например: нет интернета в офисе с утра",
  access: "Например: выдать доступ к камерам охране",
  docs: "Например: подготовить акт и счёт",
  other: "Что нужно сделать",
};

type FormState = {
  dealId: string;
  kind: TaskKind;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
  assigneeId: string;
};

const fromTask = (t: Task): FormState => ({
  dealId: String(t.dealId),
  kind: t.kind,
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
  const existing = useApi<Task>(id ? `/tasks/${id}` : null);
  const deals = useApi<Deal[]>("/deals");
  const users = useApi<User[]>(staff ? "/users" : null);
  const [form, setForm] = useState<FormState>({
    dealId: dealId ?? "",
    kind: "other",
    title: "",
    description: "",
    priority: "normal",
    dueDate: "",
    assigneeId: "",
  });
  const photoDraft = usePhotoDraft();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing.data) {
      setForm(fromTask(existing.data));
    }
  }, [existing.data]);

  useEffect(() => {
    const only = deals.data?.length === 1 ? deals.data[0] : undefined;
    if (only && !form.dealId) {
      setForm((f) => ({ ...f, dealId: String(only.id) }));
    }
  }, [deals.data, form.dealId]);

  if ((id && !existing.data) || !deals.data) {
    return <Pending error={existing.error ?? deals.error} />;
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
    const body = toBody(form, staff);
    try {
      const task = await api<Task>(id ? `/tasks/${id}` : "/tasks", {
        method: id ? "PATCH" : "POST",
        body,
      });
      await sendPhotos(task.id, photoDraft);
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
                  {SERVICE_ICONS[d.service]} {d.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <KindPicker
        onChange={(kind) =>
          setForm((f) => ({
            ...f,
            kind,
            // A breakdown is urgent unless said otherwise.
            priority: kind === "repair" ? "urgent" : f.priority,
          }))
        }
        value={form.kind}
      />
      <Field label="Что нужно сделать">
        <input
          maxLength={200}
          onChange={set("title")}
          placeholder={TITLE_HINTS[form.kind]}
          required
          value={form.title}
        />
      </Field>
      <Field label="Подробности">
        <textarea
          maxLength={5000}
          onChange={set("description")}
          placeholder="Адрес, этаж/кабинет, контакт на месте, что именно не работает"
          value={form.description}
        />
      </Field>
      <PhotosField draft={photoDraft} />
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
      <button
        className="btn block"
        disabled={saving || photoDraft.preparing}
        type="submit"
      >
        {id ? "Сохранить" : "Создать задачу"}
      </button>
    </form>
  );
};
