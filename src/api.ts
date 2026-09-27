import type { ItemCard, ItemDetail, Source, Status } from "../shared/types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") onUnauthorized();
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export type ItemView = "inbox" | "unread" | "saved" | "all" | "recent" | "hidden";
export type Page = { items: ItemCard[]; next: number | null };
export type SearchHit = ItemCard & { match: string | null };
export type CycleResult = { checked: number; added: number; processed: number; errors: { sourceId: number; error: string }[] };

export const api = {
  session: () => request<{ signedIn: boolean }>("/session"),
  login: (password: string) => request<{ ok: true }>("/login", { method: "POST", json: { password } }),
  logout: () => request<{ ok: true }>("/logout", { method: "POST", json: {} }),

  items: (view: ItemView, opts: { source?: number; before?: number | null; limit?: number } = {}) => {
    const q = new URLSearchParams({ view });
    if (opts.source) q.set("source", String(opts.source));
    if (opts.before) q.set("before", String(opts.before));
    if (opts.limit) q.set("limit", String(opts.limit));
    return request<Page>(`/items?${q}`);
  },
  item: (id: number) => request<ItemDetail>(`/items/${id}`),
  setState: (id: number, state: { isRead?: boolean; isSaved?: boolean; isHidden?: boolean; readingPosition?: number; opened?: boolean }) =>
    request<{ ok: true }>(`/items/${id}/state`, { method: "PATCH", json: state, keepalive: true }),
  markAllRead: (ids: number[]) => request<{ ok: true }>("/items/read-all", { method: "POST", json: { ids } }),
  report: (id: number, note: string) => request<{ ok: true }>(`/items/${id}/report`, { method: "POST", json: { note } }),
  addArticle: (url: string) => request<{ id: number }>("/articles", { method: "POST", json: { url } }),
  search: (q: string) => request<{ items: SearchHit[] }>(`/search?q=${encodeURIComponent(q)}`),

  sources: () => request<Source[]>("/sources"),
  addSource: (url: string) => request<{ source: Source; added: number }>("/sources", { method: "POST", json: { url } }),
  updateSource: (id: number, patch: { name?: string; enabled?: boolean; checkFrequency?: number }) =>
    request<{ ok: true }>(`/sources/${id}`, { method: "PATCH", json: patch }),
  deleteSource: (id: number) => request<{ ok: true }>(`/sources/${id}`, { method: "DELETE", json: {} }),
  refreshSource: (id: number) => request<{ added: number; error?: string }>(`/sources/${id}/refresh`, { method: "POST", json: {} }),

  refresh: (force: boolean) => request<CycleResult>("/refresh", { method: "POST", json: { force } }),
  status: () => request<Status>("/status"),
};
