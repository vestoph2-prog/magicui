import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import {
  EQUIPMENT_LABELS,
  EQUIPMENT_TYPES,
  type Equipment,
  type EquipmentType,
} from "../../../shared/model.ts";
import { api, errorText, useApi } from "../api.ts";
import { formatDue } from "../format.ts";
import { goBack, navigate } from "../router.ts";
import { alertMessage, confirmAction, haptic } from "../telegram.ts";
import {
  ErrorBox,
  Field,
  go,
  Loading,
  PageTitle,
  SectionTitle,
} from "../ui.tsx";

const copy = (label: string, value: string) => {
  navigator.clipboard
    ?.writeText(value)
    .then(() => {
      haptic.success();
      alertMessage(`${label} скопирован: ${value}`);
    })
    .catch(() => null);
};

const Copyable = ({ label, value }: { label: string; value: string }) =>
  value ? (
    <button
      className="link-btn copyable"
      onClick={(e) => {
        e.stopPropagation();
        copy(label, value);
      }}
      type="button"
    >
      {label} {value}
    </button>
  ) : null;

const EquipmentCard = ({
  item,
  canEdit,
}: {
  item: Equipment;
  canEdit: boolean;
}) => {
  const body = (
    <>
      <div className="row">
        <b>{EQUIPMENT_LABELS[item.type]}</b>
        <span className="spacer" />
        {item.installedAt ? (
          <span className="hint">с {formatDue(item.installedAt)}</span>
        ) : null}
      </div>
      {item.model ? <div className="card-title">{item.model}</div> : null}
      <div className="card-meta">
        {item.location ? <span>📍 {item.location}</span> : null}
        <Copyable label="S/N" value={item.serial} />
        <Copyable label="IP" value={item.ip} />
        <Copyable label="MAC" value={item.mac} />
      </div>
      {item.notes ? <div className="hint">{item.notes}</div> : null}
    </>
  );
  // Staff open the editor; the customer just sees the card.
  return canEdit ? (
    <div className="card">
      {body}
      <button
        className="link-btn"
        onClick={go(`/objects/${item.objectId}/equipment/${item.id}`)}
        style={{ padding: "6px 0 0" }}
        type="button"
      >
        ✏️ Изменить
      </button>
    </div>
  ) : (
    <div className="card">{body}</div>
  );
};

export const EquipmentSection = ({
  objectId,
  canEdit,
}: {
  objectId: number;
  canEdit: boolean;
}) => {
  const list = useApi<Equipment[]>(`/objects/${objectId}/equipment`);
  const items = list.data ?? [];
  if (!(items.length || canEdit)) {
    return null;
  }
  return (
    <>
      <div className="page-title" style={{ marginTop: 18 }}>
        <SectionTitle>Оборудование · {items.length}</SectionTitle>
        {canEdit ? (
          <button
            className="btn small"
            onClick={go(`/objects/${objectId}/equipment/new`)}
            type="button"
          >
            + Добавить
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <div className="stack">
        {items.map((item) => (
          <EquipmentCard canEdit={canEdit} item={item} key={item.id} />
        ))}
      </div>
      {list.data && items.length === 0 ? (
        <div className="hint" style={{ padding: "0 6px" }}>
          Запишите регистраторы, роутеры и камеры с серийниками и IP —
          пригодится при выезде и гарантии.
        </div>
      ) : null}
    </>
  );
};

type FormState = {
  type: EquipmentType;
  model: string;
  serial: string;
  ip: string;
  mac: string;
  location: string;
  installedAt: string;
  notes: string;
};

const EMPTY: FormState = {
  type: "camera",
  model: "",
  serial: "",
  ip: "",
  mac: "",
  location: "",
  installedAt: "",
  notes: "",
};

const toForm = (e: Equipment): FormState => ({
  type: e.type,
  model: e.model,
  serial: e.serial,
  ip: e.ip,
  mac: e.mac,
  location: e.location,
  installedAt: e.installedAt ?? "",
  notes: e.notes,
});

const TypePicker = ({
  value,
  onChange,
}: {
  value: EquipmentType;
  onChange: (t: EquipmentType) => void;
}) => (
  <div className="field">
    <span>Тип</span>
    <div className="chips" style={{ flexWrap: "wrap", margin: 0, padding: 0 }}>
      {EQUIPMENT_TYPES.map((t) => (
        <button
          aria-pressed={value === t}
          className="chip"
          key={t}
          onClick={() => onChange(t)}
          type="button"
        >
          {EQUIPMENT_LABELS[t]}
        </button>
      ))}
    </div>
  </div>
);

export const EquipmentFormScreen = ({
  objectId,
  id,
}: {
  objectId: number;
  id?: number;
}) => {
  const list = useApi<Equipment[]>(
    id ? `/objects/${objectId}/equipment` : null
  );
  const existing = list.data?.find((e) => e.id === id);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) {
      setForm(toForm(existing));
    }
  }, [existing]);

  if (id && !existing) {
    return list.error || list.data ? (
      <ErrorBox message={list.error ?? "Оборудование не найдено"} />
    ) : (
      <Loading />
    );
  }

  const set =
    (key: keyof FormState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(id ? `/equipment/${id}` : `/objects/${objectId}/equipment`, {
        method: id ? "PATCH" : "POST",
        body: { ...form, installedAt: form.installedAt || null },
      });
      haptic.success();
      navigate(`/objects/${objectId}`, true);
    } catch (err) {
      haptic.error();
      setError(errorText(err));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!(id && (await confirmAction("Удалить запись об оборудовании?")))) {
      return;
    }
    await api(`/equipment/${id}`, { method: "DELETE" });
    haptic.success();
    goBack(`/objects/${objectId}`);
  };

  return (
    <form className="form" onSubmit={submit}>
      <PageTitle title={id ? "Оборудование" : "Новое оборудование"} />
      <ErrorBox message={error} />
      <TypePicker
        onChange={(type) => setForm((f) => ({ ...f, type }))}
        value={form.type}
      />
      <Field label="Модель">
        <input
          maxLength={200}
          onChange={set("model")}
          placeholder="Например: Hikvision DS-2CD1043G0-I"
          value={form.model}
        />
      </Field>
      <Field label="Место установки">
        <input
          maxLength={200}
          onChange={set("location")}
          placeholder="Вход, парковка, серверная, стойка 1…"
          value={form.location}
        />
      </Field>
      <div className="row" style={{ alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <Field label="Серийный номер">
            <input
              maxLength={200}
              onChange={set("serial")}
              value={form.serial}
            />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <Field label="Дата монтажа">
            <input
              onChange={set("installedAt")}
              type="date"
              value={form.installedAt}
            />
          </Field>
        </div>
      </div>
      <div className="row" style={{ alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <Field label="IP-адрес">
            <input
              inputMode="decimal"
              maxLength={64}
              onChange={set("ip")}
              placeholder="192.168.1.64"
              value={form.ip}
            />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <Field label="MAC">
            <input maxLength={64} onChange={set("mac")} value={form.mac} />
          </Field>
        </div>
      </div>
      <Field label="Примечание">
        <textarea
          maxLength={1000}
          onChange={set("notes")}
          placeholder="Прошивка, объём HDD, порт коммутатора… Пароли сюда не пишите."
          value={form.notes}
        />
      </Field>
      <button className="btn block" disabled={saving} type="submit">
        {id ? "Сохранить" : "Добавить"}
      </button>
      {id ? (
        <button className="btn danger block" onClick={remove} type="button">
          🗑 Удалить
        </button>
      ) : null}
    </form>
  );
};
