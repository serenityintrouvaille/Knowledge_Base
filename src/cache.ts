// Keeps list screens instant and in place when returning from an article.

import { useEffect, useLayoutEffect } from "react";

const data = new Map<string, unknown>();
const scroll = new Map<string, number>();

export const listCache = {
  get: <T,>(key: string) => data.get(key) as T | undefined,
  set: (key: string, value: unknown) => void data.set(key, value),
  clear: () => data.clear(),
};

/** Save the window scroll for `key` on unmount and restore it once `ready`. */
export function useScrollMemory(key: string, ready: boolean) {
  useLayoutEffect(() => {
    if (ready) window.scrollTo(0, scroll.get(key) ?? 0);
  }, [key, ready]);
  useEffect(() => {
    const save = () => scroll.set(key, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [key]);
}
