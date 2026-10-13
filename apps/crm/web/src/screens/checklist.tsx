import { type FormEvent, useState } from "react";
import type { ChecklistItem } from "../../../shared/model.ts";
import { api, errorText, useApi } from "../api.ts";
import { alertMessage, haptic } from "../telegram.ts";

/**
 * Work steps of a task. Staff tick and edit them; the customer sees
 * progress. `onChanged` lets the task card refresh its counters.
 */
export const Checklist = ({
  taskId,
  editable,
  version,
  onChanged,
}: {
  taskId: number;
  editable: boolean;
  /** Bump to refetch (e.g. someone else changed the task). */
  version: string;
  onChanged: () => void;
}) => {
  const items = useApi<ChecklistItem[]>(
    `/tasks/${taskId}/checklist?v=${encodeURIComponent(version)}`
  );
  const [text, setText] = useState("");
  const list = items.data ?? [];
  if (!(list.length || editable)) {
    return null;
  }
  const done = list.filter((i) => i.done).length;

  const call = async (path: string, method: string, body?: unknown) => {
    try {
      items.setData(await api<ChecklistItem[]>(path, { method, body }));
      onChanged();
    } catch (e) {
      haptic.error();
      alertMessage(errorText(e));
      items.reload();
    }
  };

  // Optimistic: tick instantly, then sync with the server's answer.
  const toggle = (item: ChecklistItem) => {
    haptic.select();
    items.setData(
      list.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i))
    );
    call(`/checklist/${item.id}`, "PATCH", { done: !item.done }).catch(
      () => null
    );
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (value) {
      setText("");
      await call(`/tasks/${taskId}/checklist`, "POST", { text: value });
    }
  };

  return (
    <div className="checklist">
      <div className="row">
        <b>☑️ Чек-лист</b>
        <span className="spacer" />
        <span className="hint">
          {done} из {list.length}
        </span>
      </div>
      {list.length ? (
        <div className="progress" role="presentation">
          <span style={{ width: `${(done / list.length) * 100}%` }} />
        </div>
      ) : null}
      <ul>
        {list.map((item) => (
          <li className={item.done ? "done" : undefined} key={item.id}>
            <label>
              <input
                checked={item.done}
                disabled={!editable}
                onChange={() => toggle(item)}
                type="checkbox"
              />
              <span>
                {item.text}
                {item.done && item.doneByName ? (
                  <small className="hint"> · {item.doneByName}</small>
                ) : null}
              </span>
            </label>
            {editable ? (
              <button
                aria-label={`Удалить пункт «${item.text}»`}
                className="link-btn"
                onClick={() =>
                  call(`/checklist/${item.id}`, "DELETE").catch(() => null)
                }
                type="button"
              >
                ✕
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {editable ? (
        <form className="checklist-add" onSubmit={add}>
          <input
            aria-label="Новый пункт"
            maxLength={300}
            onChange={(e) => setText(e.target.value)}
            placeholder="+ пункт чек-листа"
            value={text}
          />
        </form>
      ) : null}
    </div>
  );
};
