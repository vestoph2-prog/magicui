import { type ReactNode, useState } from "react";
import {
  CONNECTION_LABELS,
  DEAL_STAGES,
  type Deal,
  type DealStage,
  hasCctv,
  hasInternet,
  isOpenStatus,
  isStaff,
  SERVICE_ICONS,
  SERVICE_LABELS,
  STAGE_LABELS,
  TASK_TEMPLATES,
  type Task,
} from "../../../shared/model.ts";
import { api, errorText, useApi } from "../api.ts";
import { formatDateTime, formatMoney } from "../format.ts";
import { goBack } from "../router.ts";
import { alertMessage, confirmAction, haptic } from "../telegram.ts";
import {
  Empty,
  ErrorBox,
  go,
  Loading,
  SectionTitle,
  StageBadge,
  TaskCard,
  useSession,
} from "../ui.tsx";

type DealData = { deal: Deal; tasks: Task[] };

const ClosedTasks = ({ tasks }: { tasks: Task[] }) => {
  const [show, setShow] = useState(false);
  if (!tasks.length) {
    return null;
  }
  return (
    <>
      <SectionTitle>
        <button
          className="link-btn"
          onClick={() => setShow((v) => !v)}
          type="button"
        >
          {show ? "Скрыть" : "Показать"} закрытые ({tasks.length})
        </button>
      </SectionTitle>
      {show ? (
        <div className="stack">
          {tasks.map((t) => (
            <TaskCard key={t.id} showDeal={false} task={t} />
          ))}
        </div>
      ) : null}
    </>
  );
};

const Prop = ({ label, value }: { label: string; value: ReactNode }) =>
  value ? (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  ) : null;

const DealProps = ({ deal }: { deal: Deal }) => (
  <dl className="props">
    <dt>Объект</dt>
    <dd>
      <button
        className="link-btn"
        onClick={go(`/objects/${deal.objectId}`)}
        style={{ padding: 0, textAlign: "left" }}
        type="button"
      >
        {deal.objectName}
      </button>
    </dd>
    <Prop label="Услуга" value={SERVICE_LABELS[deal.service]} />
    {hasInternet(deal.service) ? (
      <>
        <Prop
          label="Скорость"
          value={deal.internetSpeed ? `${deal.internetSpeed} Мбит/с` : ""}
        />
        <Prop
          label="Подключение"
          value={deal.connectionType && CONNECTION_LABELS[deal.connectionType]}
        />
      </>
    ) : null}
    {hasCctv(deal.service) ? (
      <>
        <Prop label="Камер" value={deal.camerasCount || ""} />
        <Prop
          label="Архив"
          value={deal.archiveDays ? `${deal.archiveDays} дней` : ""}
        />
      </>
    ) : null}
    <Prop
      label="Абонплата"
      value={deal.monthlyFee ? `${formatMoney(deal.monthlyFee)} / мес` : ""}
    />
    <Prop label="Заказчик" value={deal.clientName} />
    <Prop label="Контакт" value={deal.clientContact} />
    <Prop label="Обновлена" value={formatDateTime(deal.updatedAt)} />
  </dl>
);

const TemplateButton = ({
  deal,
  onDone,
}: {
  deal: Deal;
  onDone: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    const titles = TASK_TEMPLATES[deal.service].map((t) => `• ${t.title}`);
    const ok = await confirmAction(
      `Создать типовые задачи (${SERVICE_LABELS[deal.service]})?\n\n${titles.join("\n")}`
    );
    if (!ok) {
      return;
    }
    setBusy(true);
    try {
      const { created } = await api<{ created: number }>(
        `/deals/${deal.id}/template`,
        { method: "POST" }
      );
      haptic.success();
      alertMessage(
        created ? `Создано задач: ${created}` : "Все типовые задачи уже есть"
      );
      onDone();
    } catch (e) {
      alertMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      className="btn secondary block"
      disabled={busy}
      onClick={apply}
      style={{ marginTop: 12 }}
      type="button"
    >
      📋 Типовые задачи: {SERVICE_LABELS[deal.service].toLowerCase()}
    </button>
  );
};

export const DealDetailScreen = ({ id }: { id: number }) => {
  const user = useSession();
  const { data, error, reload } = useApi<DealData>(`/deals/${id}`);

  if (!data) {
    return error ? <ErrorBox message={error} /> : <Loading />;
  }
  const { deal, tasks } = data;
  const staff = isStaff(user.role);
  const open = tasks.filter((t) => isOpenStatus(t.status));
  const closed = tasks.filter((t) => !isOpenStatus(t.status));

  const setStage = async (stage: DealStage) => {
    try {
      await api(`/deals/${deal.id}`, { method: "PATCH", body: { stage } });
      haptic.success();
      reload();
    } catch (e) {
      alertMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async () => {
    const ok = await confirmAction(
      `Удалить сделку «${deal.title}» вместе со всеми задачами?`
    );
    if (!ok) {
      return;
    }
    try {
      await api(`/deals/${deal.id}`, { method: "DELETE" });
      haptic.success();
      goBack("/deals");
    } catch (e) {
      alertMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="detail">
        <div className="row">
          <StageBadge stage={deal.stage} />
          <span className="spacer" />
          {deal.amount ? <b>{formatMoney(deal.amount)}</b> : null}
        </div>
        <h2 style={{ marginTop: 10 }}>
          {SERVICE_ICONS[deal.service]} {deal.title}
        </h2>
        <DealProps deal={deal} />
        {deal.notes ? <p className="description">{deal.notes}</p> : null}
        {staff ? (
          <>
            <label className="field" style={{ marginTop: 12 }}>
              <span>Этап сделки</span>
              <select
                onChange={(e) => setStage(e.target.value as DealStage)}
                value={deal.stage}
              >
                {DEAL_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <div className="actions">
              <button
                className="btn secondary small"
                onClick={go(`/deals/${deal.id}/edit`)}
                type="button"
              >
                ✏️ Редактировать
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
          </>
        ) : null}
      </div>

      <div className="page-title" style={{ marginTop: 18 }}>
        <h3 className="section-title" style={{ margin: 0 }}>
          Задачи · {open.length} открыто
        </h3>
        <button
          className="btn small"
          onClick={go(`/tasks/new?dealId=${deal.id}`)}
          type="button"
        >
          + Задача
        </button>
      </div>
      <div className="stack">
        {open.map((t) => (
          <TaskCard key={t.id} showDeal={false} task={t} />
        ))}
      </div>
      {open.length === 0 ? <Empty>Открытых задач нет</Empty> : null}
      {staff ? <TemplateButton deal={deal} onDone={reload} /> : null}
      <ClosedTasks tasks={closed} />
    </>
  );
};
