import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const freePort = async (): Promise<number> => {
  const srv = createServer();
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  const address = srv.address();
  srv.close();
  if (!address || typeof address === "string") {
    throw new Error("no port");
  }
  return address.port;
};

export type TestServer = {
  url: string;
  as: (
    who: string
  ) => <T = unknown>(
    path: string,
    options?: { method?: string; body?: unknown; raw?: Blob }
  ) => Promise<{ status: number; data: T }>;
  stop: () => Promise<void>;
};

/** Boots the real server on an in-memory DB with dev auth and no bot. */
export const startServer = async (): Promise<TestServer> => {
  const port = await freePort();
  const child: ChildProcess = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "server/index.ts"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        DB_PATH: ":memory:",
        DEV_AUTH: "1",
        BOT_TOKEN: "",
        ADMIN_IDS: "",
        DIGEST_HOUR: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let log = "";
  child.stdout?.on("data", (d) => {
    log += String(d);
  });
  child.stderr?.on("data", (d) => {
    log += String(d);
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    if (log.includes("CRM запущена")) {
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!log.includes("CRM запущена")) {
    child.kill();
    throw new Error(`server did not start:\n${log}`);
  }
  const as =
    (who: string) =>
    async <T = unknown>(
      path: string,
      options: { method?: string; body?: unknown; raw?: Blob } = {}
    ) => {
      const headers: Record<string, string> = {
        authorization: `dev ${encodeURIComponent(who)}`,
      };
      let body: BodyInit | undefined;
      if (options.raw) {
        headers["content-type"] = options.raw.type;
        body = options.raw;
      } else if (options.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(options.body);
      }
      const res = await fetch(`${url}${path}`, {
        method: options.method ?? "GET",
        headers,
        body,
      });
      const text = await res.text();
      return {
        status: res.status,
        data: (text ? JSON.parse(text) : null) as T,
      };
    };
  return {
    url,
    as,
    stop: async () => {
      child.kill();
      await once(child, "exit");
    },
  };
};

/** Smallest valid PNG (1×1). */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
