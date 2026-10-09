import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type {
  ChatUpdate,
  ChecklistItem,
  Dashboard,
  Deal,
  InboxItem,
  Invite,
  Message,
  Task,
  User,
} from "../shared/model.ts";
import { PNG, startServer, type TestServer } from "./helpers.ts";

let server: TestServer;
let admin: ReturnType<TestServer["as"]>;
let manager: ReturnType<TestServer["as"]>;
let client: ReturnType<TestServer["as"]>;
let stranger: ReturnType<TestServer["as"]>;
let deal: Deal;

const inviteCode = async (role: string) => {
  const res = await admin<Invite>("/api/invites", {
    method: "POST",
    body: { role },
  });
  assert.equal(res.status, 200);
  return res.data.code;
};

before(async () => {
  server = await startServer();
  admin = server.as("1:Алексей");
  const me = await admin<{ user: User }>("/api/me");
  assert.equal(me.data.user.role, "admin", "first user becomes admin");

  await server.as(`2:Мария:inv_${await inviteCode("manager")}`)("/api/me");
  await server.as(`3:Иван:inv_${await inviteCode("client")}`)("/api/me");
  manager = server.as("2:Мария");
  client = server.as("3:Иван");
  stranger = server.as("9:Чужой");

  const object = await manager<{ id: number }>("/api/objects", {
    method: "POST",
    body: { name: "Офис", address: "Баумана, 1" },
  });
  const created = await manager<Deal>("/api/deals", {
    method: "POST",
    body: {
      objectId: object.data.id,
      title: "Видеонаблюдение",
      service: "cctv",
      camerasCount: 8,
    },
  });
  deal = created.data;
});

after(async () => {
  await server.stop();
});

describe("access", () => {
  it("keeps strangers out until invited", async () => {
    const me = await stranger<{ user: User }>("/api/me");
    assert.equal(me.data.user.role, "guest");
    assert.equal((await stranger("/api/tasks")).status, 403);
  });

  it("invites are single-use and never downgrade", async () => {
    const code = await inviteCode("client");
    await server.as(`4:Пётр:inv_${code}`)("/api/me");
    const reuse = await server.as(`5:Ещё:inv_${code}`)<{ user: User }>(
      "/api/me"
    );
    assert.equal(reuse.data.user.role, "guest");
    const again = await server.as(
      `1:Алексей:inv_${await inviteCode("client")}`
    )<{
      user: User;
    }>("/api/me");
    assert.equal(again.data.user.role, "admin");
  });

  it("only staff manage deals", async () => {
    const res = await client("/api/deals", {
      method: "POST",
      body: { objectId: deal.objectId, title: "x" },
    });
    assert.equal(res.status, 403);
  });
});

describe("tasks", () => {
  let task: Task;

  it("client raises a breakdown that is urgent by default", async () => {
    const res = await client<Task>("/api/tasks", {
      method: "POST",
      body: {
        dealId: deal.id,
        kind: "repair",
        title: "Камера не показывает",
        assigneeId: 2,
      },
    });
    assert.equal(res.status, 200);
    task = res.data;
    assert.equal(task.priority, "urgent");
    assert.equal(task.assigneeId, null, "clients cannot assign");
  });

  it("client cannot move work forward, only accept it", async () => {
    const forbidden = await client(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: { status: "done" },
    });
    assert.equal(forbidden.status, 403);
    await manager(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: { status: "review", assigneeId: 2 },
    });
    const accepted = await client<Task>(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: { status: "done" },
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.status, "done");
  });

  it("stores the visit time in UTC and counts today's visits", async () => {
    const soon = new Date(Date.now() + 30 * 60_000);
    soon.setSeconds(0, 0);
    const res = await manager<Task>(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: { status: "in_progress", visitAt: soon.toISOString() },
    });
    assert.equal(res.data.visitAt, soon.toISOString());
    const bad = await manager(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: { visitAt: "завтра" },
    });
    assert.equal(bad.status, 400);
  });

  it("rejects malformed dates", async () => {
    const res = await manager("/api/tasks", {
      method: "POST",
      body: { dealId: deal.id, title: "x", dueDate: "10.10.2026" },
    });
    assert.equal(res.status, 400);
  });
});

describe("templates and checklists", () => {
  it("creates the CCTV plan with checklists once", async () => {
    const first = await manager<{ created: number }>(
      `/api/deals/${deal.id}/template`,
      { method: "POST" }
    );
    assert.ok(first.data.created >= 5);
    const second = await manager<{ created: number }>(
      `/api/deals/${deal.id}/template`,
      { method: "POST" }
    );
    assert.equal(second.data.created, 0, "no duplicates");

    const tasks = await manager<Task[]>(`/api/tasks?dealId=${deal.id}`);
    const nvr = tasks.data.find((t) => t.title.includes("регистратора"));
    assert.ok(nvr);
    assert.ok(nvr.checklistTotal >= 3);
    assert.equal(nvr.checklistDone, 0);

    const items = await manager<ChecklistItem[]>(
      `/api/tasks/${nvr.id}/checklist`
    );
    const firstItem = items.data[0];
    assert.ok(firstItem);
    const ticked = await manager<ChecklistItem[]>(
      `/api/checklist/${firstItem.id}`,
      { method: "PATCH", body: { done: true } }
    );
    assert.equal(ticked.data[0]?.done, true);
    assert.equal(ticked.data[0]?.doneByName, "Мария");

    const byClient = await client(`/api/checklist/${firstItem.id}`, {
      method: "PATCH",
      body: { done: false },
    });
    assert.equal(byClient.status, 403);
  });
});

describe("chat", () => {
  let task: Task;

  before(async () => {
    const res = await client<Task>("/api/tasks", {
      method: "POST",
      body: { dealId: deal.id, title: "Нужен доступ к камерам" },
    });
    task = res.data;
  });

  it("delivers messages with replies and unread counters", async () => {
    const q = await client<Message>(`/api/tasks/${task.id}/messages`, {
      method: "POST",
      body: { body: "Когда приедете?" },
    });
    const a = await manager<Message>(`/api/tasks/${task.id}/messages`, {
      method: "POST",
      body: { body: "Завтра в 10", replyTo: q.data.id },
    });
    assert.equal(a.data.replyBody, "Когда приедете?");

    const unread = await client<{ total: number }>("/api/unread");
    assert.ok(unread.data.total >= 1);
    const inbox = await client<InboxItem[]>("/api/inbox");
    assert.equal(inbox.data[0]?.taskId, task.id);
    assert.equal(inbox.data[0]?.lastBody, "Завтра в 10");

    const chat = await client<ChatUpdate>(`/api/tasks/${task.id}/chat`);
    assert.equal(chat.data.messages.length, 2);
    const afterOpen = await client<InboxItem[]>("/api/inbox");
    assert.equal(
      afterOpen.data[0]?.unreadCount,
      0,
      "opening the chat reads it"
    );
  });

  it("accepts photos and rejects anything else", async () => {
    const ok = await manager<{ file: string }>("/api/uploads", {
      method: "POST",
      raw: new Blob([PNG], { type: "image/png" }),
    });
    assert.equal(ok.status, 200);
    const fake = await manager("/api/uploads", {
      method: "POST",
      raw: new Blob(["<script>"], { type: "image/png" }),
    });
    assert.equal(fake.status, 415);

    const msg = await manager<Message>(`/api/tasks/${task.id}/messages`, {
      method: "POST",
      body: { body: "", attachments: [ok.data.file, "../../etc/passwd"] },
    });
    assert.deepEqual(msg.data.attachments, [ok.data.file]);

    const img = await fetch(`${server.url}/uploads/${ok.data.file}`);
    assert.equal(img.headers.get("content-type"), "image/png");
    const traversal = await fetch(
      `${server.url}/uploads/..%2f..%2fpackage.json`
    );
    assert.equal(traversal.status, 404);
  });

  it("lets people delete only their own messages", async () => {
    const mine = await client<Message>(`/api/tasks/${task.id}/messages`, {
      method: "POST",
      body: { body: "опечатка" },
    });
    const byOther = await manager(`/api/messages/${mine.data.id}`, {
      method: "DELETE",
    });
    assert.equal(byOther.status, 403);
    const byAuthor = await client(`/api/messages/${mine.data.id}`, {
      method: "DELETE",
    });
    assert.equal(byAuthor.status, 200);
  });
});

describe("dashboard", () => {
  it("reports visits today and urgent work", async () => {
    const d = await manager<Dashboard>("/api/dashboard");
    assert.equal(d.status, 200);
    assert.ok(d.data.visitsToday >= 1);
    assert.equal(typeof d.data.urgentOpen, "number");
  });
});
