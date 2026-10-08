import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import {
  CONNECTION_LABELS,
  CONNECTION_TYPES,
  type ConnectionType,
  type CrmObject,
  DEAL_STAGES,
  type Deal,
  type DealStage,
  hasCctv,
  hasInternet,
  SERVICE_ICONS,
  SERVICE_LABELS,
  SERVICES,
  type Service,
  STAGE_LABELS,
} from "../../../shared/model.ts";
import { api, errorText, useApi } from "../api.ts";
import { navigate } from "../router.ts";
import { haptic } from "../telegram.ts";
import { Empty, ErrorBox, Field, Loading, PageTitle } from "../ui.tsx";

const SPACES_RE = /\s/g;

const NUMERIC = [
  "amount",
  "monthlyFee",
  "internetSpeed",
  "camerasCount",
  "archiveDays",
] as const;
type NumericKey = (typeof NUMERIC)[number];

type FormState = Record<NumericKey, string> & {
  objectId: string;
  title: string;
  service: Service;
  connectionType: ConnectionType;
  clientName: string;
  clientContact: string;
  stage: DealStage;
  notes: string;
};

const EMPTY: FormState = {
  objectId: "",
  title: "",
  service: "internet",
  connectionType: "",
  clientName: "",
  clientContact: "",
  stage: "lead",
  notes: "",
  amount: "",
  monthlyFee: "",
  internetSpeed: "",
  camerasCount: "",
  archiveDays: "",
};

const fromDeal = (d: Deal): FormState => ({
  objectId: String(d.objectId),
  title: d.title,
  service: d.service,
  connectionType: d.connectionType,
  clientName: d.clientName,
  clientContact: d.clientContact,
  stage: d.stage,
  notes: d.notes,
  amount: d.amount ? String(d.amount) : "",
  monthlyFee: d.monthlyFee ? String(d.monthlyFee) : "",
  internetSpeed: d.internetSpeed ? String(d.internetSpeed) : "",
  camerasCount: d.camerasCount ? String(d.camerasCount) : "",
  archiveDays: d.archiveDays ? String(d.archiveDays) : "",
});

const toNumber = (s: string): number =>
  Number(s.replace(SPACES_RE, "").replace(",", ".")) || 0;

const toBody = (form: FormState) => ({
  ...form,
  objectId: Number(form.objectId),
  ...Object.fromEntries(NUMERIC.map((k) => [k, toNumber(form[k])])),
});

type Change = ChangeEvent<
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
>;

const Half = ({ children }: { children: ReactNode }) => (
  <div style={{ flex: 1, minWidth: 140 }}>{children}</div>
);

const ServiceFields = ({
  form,
  set,
}: {
  form: FormState;
  set: (key: keyof FormState) => (e: Change) => void;
}) => (
  <>
    {hasInternet(form.service) ? (
      <div className="row" style={{ alignItems: "stretch" }}>
        <Half>
          <Field label="🌐 Скорость, Мбит/с">
            <input
              inputMode="numeric"
              onChange={set("internetSpeed")}
              placeholder="100"
              value={form.internetSpeed}
            />
          </Field>
        </Half>
        <Half>
          <Field label="Тип подключения">
            <select
              onChange={set("connectionType")}
              value={form.connectionType}
            >
              {CONNECTION_TYPES.map((c) => (
                <option key={c} value={c}>
                  {CONNECTION_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
        </Half>
      </div>
    ) : null}
    {hasCctv(form.service) ? (
      <div className="row" style={{ alignItems: "stretch" }}>
        <Half>
          <Field label="📹 Кол-во камер">
            <input
              inputMode="numeric"
              onChange={set("camerasCount")}
              placeholder="8"
              value={form.camerasCount}
            />
          </Field>
        </Half>
        <Half>
          <Field label="Глубина архива, дней">
            <input
              inputMode="numeric"
              onChange={set("archiveDays")}
              placeholder="30"
              value={form.archiveDays}
            />
          </Field>
        </Half>
      </div>
    ) : null}
  </>
);

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
    ...EMPTY,
    objectId: objectId ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing.data) {
      setForm(fromDeal(existing.data.deal));
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
        Сначала добавьте объект (адрес подключения).
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

  const set = (key: keyof FormState) => (e: Change) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const deal = await api<Deal>(id ? `/deals/${id}` : "/deals", {
        method: id ? "PATCH" : "POST",
        body: toBody(form),
      });
      haptic.success();
      navigate(`/deals/${deal.id}`, true);
    } catch (err) {
      haptic.error();
      setError(errorText(err));
      setSaving(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <PageTitle title={id ? "Редактирование сделки" : "Новая сделка"} />
      <ErrorBox message={error} />
      <div className="field">
        <span>Услуга</span>
        <div
          className="chips"
          style={{ flexWrap: "wrap", margin: 0, padding: 0 }}
        >
          {SERVICES.map((s) => (
            <button
              aria-pressed={form.service === s}
              className="chip"
              key={s}
              onClick={() => setForm((f) => ({ ...f, service: s }))}
              type="button"
            >
              {SERVICE_ICONS[s]} {SERVICE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
      <Field label="Объект (адрес)">
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
          placeholder="Например: подключение офиса 300 Мбит/с"
          required
          value={form.title}
        />
      </Field>
      <ServiceFields form={form} set={set} />
      <div className="row" style={{ alignItems: "stretch" }}>
        <Half>
          <Field label="Монтаж / разово, ₽">
            <input
              inputMode="decimal"
              onChange={set("amount")}
              placeholder="0"
              value={form.amount}
            />
          </Field>
        </Half>
        <Half>
          <Field label="Абонплата, ₽/мес">
            <input
              inputMode="decimal"
              onChange={set("monthlyFee")}
              placeholder="0"
              value={form.monthlyFee}
            />
          </Field>
        </Half>
      </div>
      <Field label="Этап">
        <select onChange={set("stage")} value={form.stage}>
          {DEAL_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
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
      <Field label="Заметки (оборудование, IP, особенности)">
        <textarea maxLength={2000} onChange={set("notes")} value={form.notes} />
      </Field>
      <button className="btn block" disabled={saving} type="submit">
        {id ? "Сохранить" : "Создать сделку"}
      </button>
    </form>
  );
};
