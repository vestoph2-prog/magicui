import { randomBytes } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { config } from "./config.ts";
import { HttpError } from "./http.ts";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const UPLOAD_DIR = resolve(
  config.dbPath === ":memory:" ? config.root : dirname(config.dbPath),
  "uploads"
);

/** 128-bit random names: the URL itself is the access token. */
const NAME_RE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Detects the format from magic bytes instead of trusting Content-Type. */
const sniff = (buf: Buffer): string | null => {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpg";
  }
  if (buf.subarray(0, 4).toString("hex") === "89504e47") {
    return "png";
  }
  if (
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  return null;
};

export const saveImage = (buf: Buffer): string => {
  const ext = sniff(buf);
  if (!ext) {
    throw new HttpError(415, "Поддерживаются только фото JPEG, PNG или WebP");
  }
  if (buf.length > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, "Файл больше 10 МБ");
  }
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${randomBytes(16).toString("hex")}.${ext}`;
  writeFileSync(join(UPLOAD_DIR, name), buf);
  return name;
};

export const readUpload = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, "Файл больше 10 МБ");
    }
    chunks.push(chunk as Buffer);
  }
  return saveImage(Buffer.concat(chunks));
};

export const isUploadName = (name: unknown): name is string =>
  typeof name === "string" && NAME_RE.test(name);

export const uploadPath = (name: string): string => join(UPLOAD_DIR, name);

export const serveUpload = (res: ServerResponse, name: string): void => {
  const file = uploadPath(name);
  if (!(isUploadName(name) && existsSync(file))) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME_BY_EXT[name.split(".").at(-1) ?? ""] ?? "image/jpeg",
    "cache-control": "private, max-age=31536000, immutable",
  });
  createReadStream(file).pipe(res);
};
