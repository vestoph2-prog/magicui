import { useCallback, useEffect, useState } from "react";
import { insideTelegram, webApp } from "./telegram.ts";

const DEV_USER_KEY = "crm-dev-user";

/** Outside Telegram (local dev with DEV_AUTH=1) we impersonate a user: ?dev=2:Имя */
const devIdentity = (): string => {
  const fromUrl = new URLSearchParams(window.location.search).get("dev");
  try {
    if (fromUrl) {
      localStorage.setItem(DEV_USER_KEY, fromUrl);
      return fromUrl;
    }
    return localStorage.getItem(DEV_USER_KEY) ?? "1:Dev";
  } catch {
    return fromUrl ?? "1:Dev";
  }
};

const authHeader = (): string => {
  if (insideTelegram && webApp) {
    return `tma ${webApp.initData}`;
  }
  const startParam = new URLSearchParams(window.location.search).get(
    "startapp"
  );
  const identity = startParam
    ? `${devIdentity()}:${startParam}`
    : devIdentity();
  return `dev ${encodeURIComponent(identity)}`;
};

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const api = async <T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: authHeader(),
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? `Ошибка ${res.status}`);
  }
  return data as T;
};

export const query = (
  params: Record<string, string | number | undefined>
): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : "";
};

export type Loadable<T> = {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
};

/** Fetches `path` and refetches whenever it changes. `null` skips loading. */
export const useApi = <T>(path: string | null): Loadable<T> => {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick forces a refetch
  useEffect(() => {
    if (path === null) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<T>(path)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload, setData };
};
