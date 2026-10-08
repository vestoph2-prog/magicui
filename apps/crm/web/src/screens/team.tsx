import { useState } from "react";
import {
  displayName,
  type Invite,
  ROLE_LABELS,
  ROLES,
  type Role,
  type User,
} from "../../../shared/model.ts";
import { api, useApi } from "../api.ts";
import { alertMessage, haptic, webApp } from "../telegram.ts";
import { ErrorBox, PageTitle, SectionTitle, useSession } from "../ui.tsx";

const shareInvite = (invite: Invite) => {
  const text = `Приглашение в CRM (${ROLE_LABELS[invite.role]})`;
  const url = `https://t.me/share/url?url=${encodeURIComponent(invite.link)}&text=${encodeURIComponent(text)}`;
  if (webApp && invite.link.startsWith("https://t.me/")) {
    webApp.openTelegramLink(url);
  } else {
    navigator.clipboard?.writeText(invite.link).catch(() => null);
    alertMessage("Ссылка скопирована");
  }
};

const InviteBlock = ({ inviteRole }: { inviteRole: Role }) => {
  const [invite, setInvite] = useState<Invite | null>(null);
  const create = async () => {
    try {
      const result = await api<Invite>("/invites", {
        method: "POST",
        body: { role: inviteRole },
      });
      haptic.success();
      setInvite(result);
    } catch (e) {
      alertMessage(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="card">
      <div className="row">
        <b>{inviteRole === "client" ? "🤝 Заказчик" : "🧑‍💼 Менеджер"}</b>
        <span className="spacer" />
        <button className="btn small secondary" onClick={create} type="button">
          Создать ссылку
        </button>
      </div>
      {invite ? (
        <>
          <div className="invite">{invite.link}</div>
          <div className="actions">
            <button
              className="btn small"
              onClick={() => shareInvite(invite)}
              type="button"
            >
              Отправить в Telegram
            </button>
            <button
              className="btn small secondary"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(invite.link)
                  .then(() => haptic.success())
                  .catch(() => null);
              }}
              type="button"
            >
              Копировать
            </button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            Ссылка одноразовая: по ней человек откроет бота и получит доступ.
          </div>
        </>
      ) : null}
    </div>
  );
};

export const TeamScreen = () => {
  const me = useSession();
  const users = useApi<User[]>("/users");
  const isAdmin = me.role === "admin";

  const changeRole = async (user: User, role: Role) => {
    try {
      await api(`/users/${user.id}`, { method: "PATCH", body: { role } });
      haptic.success();
      users.reload();
    } catch (e) {
      alertMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <PageTitle title="Команда" />
      <ErrorBox message={users.error} />
      <div className="stack">
        {users.data?.map((u) => (
          <div className="card" key={u.id}>
            <div className="row">
              <div>
                <b>{displayName(u)}</b>
                {u.id === me.id ? <span className="hint"> (вы)</span> : null}
                {u.username ? <div className="hint">@{u.username}</div> : null}
              </div>
              <span className="spacer" />
              {isAdmin && u.id !== me.id ? (
                <select
                  aria-label={`Роль ${displayName(u)}`}
                  className="chip"
                  onChange={(e) => changeRole(u, e.target.value as Role)}
                  value={u.role}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="badge">{ROLE_LABELS[u.role]}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <SectionTitle>Пригласить</SectionTitle>
      <div className="stack">
        <InviteBlock inviteRole="client" />
        {isAdmin ? <InviteBlock inviteRole="manager" /> : null}
      </div>
      <p className="hint" style={{ margin: "12px 6px" }}>
        Если человек уже открыл бота без ссылки, он появится в списке со
        статусом «Без доступа» — администратор может выдать роль вручную.
      </p>
    </>
  );
};
