import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import {
  type CrmObject,
  type Deal,
  isStaff,
  type Task,
} from "../../../shared/model.ts";
import { api, useApi } from "../api.ts";
import { goBack, navigate } from "../router.ts";
import { alertMessage, confirmAction, haptic } from "../telegram.ts";
import {
  DealCard,
  Empty,
  ErrorBox,
  Fab,
  Field,
  go,
  Loading,
  ObjectCard,
  PageTitle,
  SectionTitle,
  TaskCard,
  useSession,
} from "../ui.tsx";

export const ObjectsScreen = () => {
  const user = useSession();
  const objects = useApi<CrmObject[]>("/objects");
  const [showArchived, setShowArchived] = useState(false);
  const list = (objects.data ?? []).filter((o) => showArchived || !o.archived);
  const archivedCount = (objects.data ?? []).filter((o) => o.archived).length;

  return (
    <>
      <PageTitle title="Объекты" />
      <ErrorBox message={objects.error} />
      <div className="stack">
        {list.map((o) => (
          <ObjectCard key={o.id} object={o} />
        ))}
      </div>
      {objects.data && list.length === 0 ? (
        <Empty>Объектов пока нет</Empty>
      ) : null}
      {archivedCount ? (
        <button
          className="link-btn"
          onClick={() => setShowArchived((v) => !v)}
          style={{ marginTop: 12 }}
          type="button"
        >
          {showArchived ? "Скрыть архив" : `Показать архив (${archivedCount})`}
        </button>
      ) : null}
      {isStaff(user.role) ? (
        <Fab label="Новый объект" to="/objects/new" />
      ) : null}
    </>
  );
};

const ObjectContacts = ({ object }: { object: CrmObject }) => (
  <dl className="props">
    {object.contactName ? (
      <>
        <dt>Контакт</dt>
        <dd>{object.contactName}</dd>
      </>
    ) : null}
    {object.contactPhone ? (
      <>
        <dt>Телефон</dt>
        <dd>
          <a
            className="link-btn"
            href={`tel:${object.contactPhone}`}
            style={{ padding: 0 }}
          >
            {object.contactPhone}
          </a>
        </dd>
      </>
    ) : null}
    {object.accessNotes ? (
      <>
        <dt>Доступ</dt>
        <dd style={{ whiteSpace: "pre-wrap" }}>🔑 {object.accessNotes}</dd>
      </>
    ) : null}
  </dl>
);

type ObjectData = { object: CrmObject; deals: Deal[] };

export const ObjectDetailScreen = ({ id }: { id: number }) => {
  const user = useSession();
  const { data, error, reload } = useApi<ObjectData>(`/objects/${id}`);
  const tasks = useApi<Task[]>(`/tasks?objectId=${id}&status=open`);

  if (!data) {
    return error ? <ErrorBox message={error} /> : <Loading />;
  }
  const { object, deals } = data;
  const staff = isStaff(user.role);

  const toggleArchive = async () => {
    await api(`/objects/${id}`, {
      method: "PATCH",
      body: { archived: !object.archived },
    });
    haptic.success();
    reload();
  };

  const remove = async () => {
    const ok = await confirmAction(
      `Удалить объект «${object.name}» со всеми сделками и задачами?`
    );
    if (!ok) {
      return;
    }
    try {
      await api(`/objects/${id}`, { method: "DELETE" });
      goBack("/objects");
    } catch (e) {
      alertMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="detail">
        <h2>
          {object.name}
          {object.archived ? " (архив)" : ""}
        </h2>
        {object.address ? (
          <div className="hint">📍 {object.address}</div>
        ) : null}
        <ObjectContacts object={object} />
        {object.description ? (
          <p className="description">{object.description}</p>
        ) : null}
        {staff ? (
          <div className="actions">
            <button
              className="btn secondary small"
              onClick={go(`/objects/${id}/edit`)}
              type="button"
            >
              ✏️ Редактировать
            </button>
            <button
              className="btn secondary small"
              onClick={toggleArchive}
              type="button"
            >
              {object.archived ? "Вернуть из архива" : "🗄 В архив"}
            </button>
            {user.role === "admin" ? (
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

      <div className="page-title" style={{ marginTop: 18 }}>
        <h3 className="section-title" style={{ margin: 0 }}>
          Сделки · {deals.length}
        </h3>
        {staff ? (
          <button
            className="btn small"
            onClick={go(`/deals/new?objectId=${id}`)}
            type="button"
          >
            + Сделка
          </button>
        ) : null}
      </div>
      <div className="stack">
        {deals.map((d) => (
          <DealCard deal={d} key={d.id} showObject={false} />
        ))}
      </div>
      {deals.length === 0 ? <Empty>Сделок по объекту нет</Empty> : null}

      {tasks.data?.length ? (
        <>
          <SectionTitle>Открытые задачи · {tasks.data.length}</SectionTitle>
          <div className="stack">
            {tasks.data.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
};

export const ObjectFormScreen = ({ id }: { id?: number }) => {
  const existing = useApi<ObjectData>(id ? `/objects/${id}` : null);
  const [form, setForm] = useState({
    name: "",
    address: "",
    description: "",
    contactName: "",
    contactPhone: "",
    accessNotes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const o = existing.data?.object;
    if (o) {
      setForm({
        name: o.name,
        address: o.address,
        description: o.description,
        contactName: o.contactName,
        contactPhone: o.contactPhone,
        accessNotes: o.accessNotes,
      });
    }
  }, [existing.data]);

  if (id && !existing.data) {
    return existing.error ? <ErrorBox message={existing.error} /> : <Loading />;
  }

  const set =
    (key: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const object = await api<CrmObject>(id ? `/objects/${id}` : "/objects", {
        method: id ? "PATCH" : "POST",
        body: form,
      });
      haptic.success();
      navigate(`/objects/${object.id}`, true);
    } catch (err) {
      haptic.error();
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <PageTitle title={id ? "Редактирование объекта" : "Новый объект"} />
      <ErrorBox message={error} />
      <Field label="Название">
        <input
          maxLength={200}
          onChange={set("name")}
          placeholder="Например: Офис РТК, БЦ «Альфа», 3 этаж"
          required
          value={form.name}
        />
      </Field>
      <Field label="Адрес">
        <input maxLength={300} onChange={set("address")} value={form.address} />
      </Field>
      <Field label="Контактное лицо на объекте">
        <input
          maxLength={200}
          onChange={set("contactName")}
          placeholder="Например: Сергей, завхоз"
          value={form.contactName}
        />
      </Field>
      <Field label="Телефон на объекте">
        <input
          inputMode="tel"
          maxLength={100}
          onChange={set("contactPhone")}
          placeholder="+7 900 000-00-00"
          type="tel"
          value={form.contactPhone}
        />
      </Field>
      <Field label="Доступ на объект">
        <textarea
          maxLength={1000}
          onChange={set("accessNotes")}
          placeholder="Режим работы, пропуск, ключи от щитовой/чердака, где стойка"
          value={form.accessNotes}
        />
      </Field>
      <Field label="Описание">
        <textarea
          maxLength={2000}
          onChange={set("description")}
          placeholder="Тип помещения, площадь, существующая сеть и камеры"
          value={form.description}
        />
      </Field>
      <button className="btn block" disabled={saving} type="submit">
        {id ? "Сохранить" : "Добавить объект"}
      </button>
    </form>
  );
};
