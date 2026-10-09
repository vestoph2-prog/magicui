import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import type { Task, User } from "../shared/model.ts";

process.env.DB_PATH = ":memory:";
process.env.BOT_TOKEN = "";
process.env.TZ_NAME = "Europe/Moscow";

const { validateInitData, AuthError } = await import("../server/auth.ts");
const { buildDigest } = await import("../server/scheduler.ts");
const { dayBoundsUtc, localParts } = await import("../server/time.ts");

const sign = (params: URLSearchParams, token: string) => {
  const dcs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(dcs).digest("hex"));
  return params.toString();
};

describe("Telegram initData", () => {
  const token = "123:ABC";
  const fresh = () =>
    new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 42, first_name: "Тест" }),
      start_param: "inv_x",
    });

  it("accepts a valid signature", () => {
    const data = validateInitData(sign(fresh(), token), token, 3600);
    assert.equal(data.user.id, 42);
    assert.equal(data.startParam, "inv_x");
  });

  it("rejects tampering and a wrong token", () => {
    const raw = sign(fresh(), token);
    assert.throws(
      () => validateInitData(raw.replace("42", "43"), token, 3600),
      AuthError
    );
    assert.throws(() => validateInitData(raw, "999:XYZ", 3600), AuthError);
  });

  it("rejects stale data", () => {
    const old = fresh();
    old.set("auth_date", String(Math.floor(Date.now() / 1000) - 7200));
    assert.throws(
      () => validateInitData(sign(old, token), token, 3600),
      AuthError
    );
  });
});

describe("time zone helpers", () => {
  it("computes Moscow day bounds in UTC", () => {
    assert.deepEqual(dayBoundsUtc("2026-10-09", "Europe/Moscow"), {
      start: "2026-10-08T21:00:00.000Z",
      end: "2026-10-09T21:00:00.000Z",
    });
  });

  it("reads the local date across midnight", () => {
    const parts = localParts(new Date("2026-10-08T22:30:00Z"), "Europe/Moscow");
    assert.deepEqual(parts, { date: "2026-10-09", hour: 1 });
  });
});

describe("morning digest", () => {
  const user = (id: number, role: User["role"]): User => ({
    id,
    firstName: "U",
    lastName: null,
    username: null,
    role,
    createdAt: "",
  });
  const task = (over: Partial<Task>): Task =>
    ({
      id: 1,
      title: "Задача",
      objectName: "Офис",
      status: "new",
      dueDate: null,
      visitAt: null,
      assigneeId: null,
      createdBy: 3,
      ...over,
    }) as Task;

  it("lists overdue, today and visits for staff", () => {
    const text = buildDigest(user(2, "manager"), {
      today: "2026-10-09",
      visits: [task({ id: 5, visitAt: "2026-10-09T10:00:00Z" })],
      due: [
        task({ id: 6, dueDate: "2026-10-01", assigneeId: 2 }),
        task({ id: 7, dueDate: "2026-10-09" }),
      ],
      clientOpen: [],
    });
    assert.ok(text);
    assert.match(text, /Выезды сегодня[\s\S]*13:00 · #5/);
    assert.match(text, /Просрочено<\/b>\n👤 #6/);
    assert.match(text, /Срок сегодня<\/b>\n#7/);
  });

  it("tells the customer what awaits acceptance", () => {
    const text = buildDigest(user(3, "client"), {
      today: "2026-10-09",
      visits: [],
      due: [],
      clientOpen: [
        task({ id: 8, status: "review" }),
        task({ id: 9, createdBy: 99 }),
      ],
    });
    assert.ok(text);
    assert.match(text, /#8/);
    assert.doesNotMatch(text, /#9/);
    assert.match(text, /Ждут вашей приёмки: 1/);
  });

  it("stays silent when there is nothing to do", () => {
    const empty = { today: "2026-10-09", visits: [], due: [], clientOpen: [] };
    assert.equal(buildDigest(user(2, "manager"), empty), null);
    assert.equal(buildDigest(user(3, "client"), empty), null);
  });
});
