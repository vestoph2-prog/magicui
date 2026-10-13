import { useEffect, useState } from "react";

export type Route = {
  /** Path segments, e.g. ["tasks", "12"]. */
  segments: string[];
  params: URLSearchParams;
};

const HASH_PREFIX_RE = /^#\/?/;

const parse = (): Route => {
  const hash = window.location.hash.replace(HASH_PREFIX_RE, "");
  const [path = "", search = ""] = hash.split("?");
  return {
    segments: path.split("/").filter(Boolean),
    params: new URLSearchParams(search),
  };
};

export const useRoute = (): Route => {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
};

export const navigate = (path: string, replace = false): void => {
  const target = `#${path}`;
  if (replace) {
    window.history.replaceState(null, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = path;
  }
};

/** Go back in history, or to `fallback` when the app was opened on a deep link. */
export const goBack = (fallback: string): void => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    navigate(fallback, true);
  }
};
