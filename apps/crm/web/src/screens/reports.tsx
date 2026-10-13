import { useState } from "react";
import { api, errorText } from "../api.ts";
import { today } from "../format.ts";
import { alertMessage, haptic } from "../telegram.ts";
import { Field, SectionTitle } from "../ui.tsx";

type ExportResult = { sent: boolean; filename: string; csv?: string };

const firstOfMonth = (): string => `${today().slice(0, 8)}01`;

/** Outside Telegram (no bot) the CSV comes back inline — save it locally. */
const saveFile = (filename: string, csv: string) => {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const Reports = () => {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (kind: "tasks" | "deals") => {
    setBusy(kind);
    try {
      const res = await api<ExportResult>("/export", {
        method: "POST",
        body: { kind, from, to },
      });
      haptic.success();
      if (res.sent) {
        alertMessage("Файл отправлен вам в чат с ботом 📎");
      } else if (res.csv) {
        saveFile(res.filename, res.csv);
      }
    } catch (e) {
      haptic.error();
      alertMessage(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionTitle>Выгрузка в Excel</SectionTitle>
      <div className="card">
        <div className="row" style={{ alignItems: "stretch" }}>
          <div style={{ flex: 1, minWidth: 130 }}>
            <Field label="С">
              <input
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                type="date"
                value={from}
              />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <Field label="По">
              <input
                min={from}
                onChange={(e) => setTo(e.target.value)}
                type="date"
                value={to}
              />
            </Field>
          </div>
        </div>
        <div className="actions">
          <button
            className="btn small"
            disabled={busy !== null}
            onClick={() => run("tasks")}
            type="button"
          >
            {busy === "tasks" ? "…" : "📤 Задачи"}
          </button>
          <button
            className="btn small"
            disabled={busy !== null}
            onClick={() => run("deals")}
            type="button"
          >
            {busy === "deals" ? "…" : "📤 Сделки"}
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Попадут созданные или изменённые за период. Файл CSV откроется в Excel
          и Google Таблицах; бот пришлёт его вам в чат.
        </div>
      </div>
    </>
  );
};
