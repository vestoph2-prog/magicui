import { createServer, type IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { AuthError, validateInitData } from "./auth.ts";
import { startBot } from "./bot.ts";
import { config } from "./config.ts";
import { HttpError, readJson, sendJson, serveStatic } from "./http.ts";
import { upsertUser } from "./repo.ts";
import { router } from "./routes.ts";
import { startScheduler } from "./scheduler.ts";
import { serveUpload } from "./uploads.ts";

const DIST = resolve(config.root, "dist");

const authenticate = (req: IncomingMessage) => {
  const header = req.headers.authorization ?? "";
  const [scheme, ...rest] = header.split(" ");
  const value = rest.join(" ");
  if (scheme === "tma" && config.botToken) {
    try {
      const data = validateInitData(value, config.botToken, config.authMaxAge);
      return { user: upsertUser(data.user), startParam: data.startParam };
    } catch (error) {
      if (error instanceof AuthError) {
        throw new HttpError(401, error.message);
      }
      throw error;
    }
  }
  if (scheme === "dev" && config.devAuth) {
    // "dev <id>:<name>[:<start_param>]" — local testing outside Telegram.
    const [id, name, startParam] = decodeURIComponent(value).split(":");
    return {
      user: upsertUser({ id: Number(id), first_name: name || `User ${id}` }),
      startParam: startParam ?? null,
    };
  }
  throw new HttpError(401, "Откройте приложение из Telegram");
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/uploads/")) {
    serveUpload(res, url.pathname.slice("/uploads/".length));
    return;
  }
  if (!url.pathname.startsWith("/api/")) {
    serveStatic(res, DIST, url.pathname);
    return;
  }
  try {
    const route = router.match(req.method ?? "GET", url.pathname);
    if (!route) {
      throw new HttpError(404, "Not found");
    }
    const { user, startParam } = authenticate(req);
    // Uploads stream the raw body themselves.
    const isJson = req.headers["content-type"]?.includes("json") ?? false;
    const body = isJson ? await readJson(req) : null;
    const result = await route.handler({
      req,
      url,
      params: route.params,
      user,
      startParam,
      body,
    });
    sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    process.stderr.write(`${req.method} ${url.pathname}: ${String(error)}\n`);
    sendJson(res, 500, { error: "Внутренняя ошибка сервера" });
  }
});

server.listen(config.port, config.host, () => {
  process.stdout.write(`CRM запущена: http://localhost:${config.port}\n`);
  startScheduler();
  startBot().catch((error: unknown) => {
    process.stderr.write(`bot failed: ${String(error)}\n`);
  });
});
