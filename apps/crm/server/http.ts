import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import type { User } from "../shared/model.ts";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Ctx = {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  user: User;
  startParam: string | null;
  body: unknown;
};

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

type Route = {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
};

const PARAM_RE = /:(\w+)/g;
const MAX_BODY = 1_000_000;

export const createRouter = () => {
  const routes: Route[] = [];
  const add = (method: string, path: string, handler: Handler) => {
    const keys: string[] = [];
    const source = path.replace(PARAM_RE, (_, key: string) => {
      keys.push(key);
      return "([^/]+)";
    });
    routes.push({
      method,
      pattern: new RegExp(`^${source}$`),
      keys,
      handler,
    });
  };
  const match = (method: string, pathname: string) => {
    for (const route of routes) {
      const m = route.pattern.exec(pathname);
      if (m && route.method === method) {
        const params: Record<string, string> = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(m[i + 1] ?? "");
        });
        return { handler: route.handler, params };
      }
    }
    return null;
  };
  return {
    get: (p: string, h: Handler) => add("GET", p, h),
    post: (p: string, h: Handler) => add("POST", p, h),
    patch: (p: string, h: Handler) => add("PATCH", p, h),
    delete: (p: string, h: Handler) => add("DELETE", p, h),
    match,
  };
};

export const readJson = async (req: IncomingMessage): Promise<unknown> => {
  if (req.method === "GET" || req.method === "DELETE") {
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) {
      throw new HttpError(413, "Слишком большой запрос");
    }
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) {
    return null;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Некорректный JSON");
  }
};

export const sendJson = (
  res: ServerResponse,
  status: number,
  data: unknown
): void => {
  const body = JSON.stringify(data ?? { ok: true });
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

export const serveStatic = (
  res: ServerResponse,
  distDir: string,
  pathname: string
): void => {
  const root = resolve(distDir);
  let file = resolve(join(root, decodeURIComponent(pathname)));
  const inside = file === root || file.startsWith(root + sep);
  if (!(inside && existsSync(file) && statSync(file).isFile())) {
    file = join(root, "index.html");
  }
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Фронтенд не собран: выполните pnpm build");
    return;
  }
  const isAsset = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": isAsset
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  createReadStream(file).pipe(res);
};
