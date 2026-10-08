import { useState } from "react";
import {
  DEAL_STAGES,
  type Deal,
  type DealStage,
  isOpenStatus,
  isStaff,
  STAGE_LABELS,
  type Task,
} from "../../../shared/model.ts";
import { api, useApi } from "../api.ts";
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
        <h2 style={{ marginTop: 10 }}>{deal.title}</h2>
        <dl className="props">
          <dt>Объект</dt>
          <dd>
            <button
              className="link-btn"
              onClick={go(`/objects/${deal.objectId}`)}
              style={{ padding: 0 }}
              type="button"
            >
              {deal.objectName}
            </button>
          </dd>
          {deal.clientName ? (
            <>
              <dt>Заказчик</dt>
              <dd>{deal.clientName}</dd>
            </>
          ) : null}
          {deal.clientContact ? (
            <>
              <dt>Контакт</dt>
              <dd>{deal.clientContact}</dd>
            </>
          ) : null}
          <dt>Обновлена</dt>
          <dd>{formatDateTime(deal.updatedAt)}</dd>
        </dl>
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
      <ClosedTasks tasks={closed} />
    </>
  );
};
