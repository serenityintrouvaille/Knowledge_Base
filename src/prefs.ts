// Per-device reading preferences. Kept in localStorage on purpose: text size and
// theme are device conveniences, not data that has to follow the account.

import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
export interface Prefs {
  theme: Theme;
  fontStep: number; // index into FONT_SIZES
}

export const FONT_SIZES = [15, 16, 17, 19, 21];
const KEY = "da-prefs";
const DEFAULTS: Prefs = { theme: "system", fontStep: 2 };

function read(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

function apply(p: Prefs) {
  const root = document.documentElement;
  if (p.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = p.theme;
  root.style.setProperty("--read-size", `${FONT_SIZES[p.fontStep] ?? 17}px`);
}

const listeners = new Set<(p: Prefs) => void>();

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState(read);
  useEffect(() => {
    listeners.add(setPrefs);
    return () => void listeners.delete(setPrefs);
  }, []);
  const update = useCallback((patch: Partial<Prefs>) => {
    const next = { ...read(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // private mode: still apply for this session
    }
    apply(next);
    listeners.forEach((l) => l(next));
  }, []);
  return [prefs, update];
}

apply(read());
