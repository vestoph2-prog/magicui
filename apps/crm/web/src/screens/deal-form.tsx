import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import {
  type CrmObject,
  DEAL_STAGES,
  type Deal,
  type DealStage,
  STAGE_LABELS,
} from "../../../shared/model.ts";
import { api, useApi } from "../api.ts";
import { navigate } from "../router.ts";
import { haptic } from "../telegram.ts";
import { Empty, ErrorBox, Field, Loading, PageTitle } from "../ui.tsx";

const SPACES_RE = /\s/g;

type FormState = {
  objectId: string;
  title: string;
  clientName: string;
  clientContact: string;
  amount: string;
  stage: DealStage;
  notes: string;
};

export const DealFormScreen = ({
  id,
  objectId,
}: {
  id?: number;
  objectId?: string;
}) => {
  const existing = useApi<{ deal: Deal }>(id ? `/deals/${id}` : null);
  const objects = useApi<CrmObject[]>("/objects");
  const [form, setForm] = useState<FormState>({
    objectId: objectId ?? "",
    title: "",
    clientName: "",
    clientContact: "",
    amount: "",
    stage: "lead",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const d = existing.data?.deal;
    if (d) {
      setForm({
        objectId: String(d.objectId),
        title: d.title,
        clientName: d.clientName,
        clientContact: d.clientContact,
        amount: d.amount ? String(d.amount) : "",
        stage: d.stage,
        notes: d.notes,
      });
    }
  }, [existing.data]);

  if ((id && !existing.data) || !objects.data) {
    return existing.error || objects.error ? (
      <ErrorBox message={existing.error ?? objects.error} />
    ) : (
      <Loading />
    );
  }

  const active = objects.data.filter(
    (o) => !o.archived || String(o.id) === form.objectId
  );
  if (active.length === 0) {
    return (
      <Empty>
        Сначала добавьте объект.
        <p>
          <button
            className="btn"
            onClick={() => navigate("/objects/new")}
            type="button"
          >
            Добавить объект
          </button>
        </p>
      </Empty>
    );
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
    try {
      const deal = await api<Deal>(id ? `/deals/${id}` : "/deals", {
        method: id ? "PATCH" : "POST",
        body: {
          ...form,
          objectId: Number(form.objectId),
          amount:
            Number(form.amount.replace(SPACES_RE, "").replace(",", ".")) || 0,
        },
      });
      haptic.success();
      navigate(`/deals/${deal.id}`, true);
    } catch (err) {
      haptic.error();
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <PageTitle title={id ? "Редактирование сделки" : "Новая сделка"} />
      <ErrorBox message={error} />
      <Field label="Объект">
        <select onChange={set("objectId")} required value={form.objectId}>
          <option disabled value="">
            Выберите объект
          </option>
          {active.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Название сделки">
        <input
          maxLength={200}
          onChange={set("title")}
          placeholder="Например: монтаж вентиляции, 2 этап"
          required
          value={form.title}
        />
      </Field>
      <Field label="Заказчик (организация / ФИО)">
        <input
          maxLength={200}
          onChange={set("clientName")}
          value={form.clientName}
        />
      </Field>
      <Field label="Контакт заказчика">
        <input
          maxLength={200}
          onChange={set("clientContact")}
          placeholder="Телефон, @username, e-mail"
          value={form.clientContact}
        />
      </Field>
      <div className="row" style={{ alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <Field label="Сумма, ₽">
            <input
              inputMode="decimal"
              onChange={set("amount")}
              placeholder="0"
              value={form.amount}
            />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <Field label="Этап">
            <select onChange={set("stage")} value={form.stage}>
              {DEAL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      <Field label="Заметки">
        <textarea maxLength={2000} onChange={set("notes")} value={form.notes} />
      </Field>
      <button className="btn block" disabled={saving} type="submit">
        {id ? "Сохранить" : "Создать сделку"}
      </button>
    </form>
  );
};
