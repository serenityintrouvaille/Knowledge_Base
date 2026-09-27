import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { ItemCard as Item, Source, Status } from "../../shared/types";
import { api, type ItemView, type Page } from "../api";
import { listCache, useScrollMemory } from "../cache";
import { ItemActions } from "../components/ItemActions";
import { ItemCard } from "../components/ItemCard";
import { IconRefresh } from "../components/Icons";
import { longDate, relative, startOfDay } from "../format";

type Filter = "all" | "unread" | "saved";
const VIEW: Record<Filter, ItemView> = { all: "inbox", unread: "unread", saved: "saved" };
const STALE_MS = 6 * 3_600_000;

interface State {
  page: Page;
  status: Status;
  sources: Source[];
}

export function Today() {
  const [filter, setFilter] = useState<Filter>(() => (sessionStorage.getItem("today-filter") as Filter) || "all");
  const [sourceId, setSourceId] = useState<number>(() => Number(sessionStorage.getItem("today-source") ?? 0));
  const key = `today:${filter}:${sourceId}`;
  const [state, setState] = useState<State | undefined>(() => listCache.get<State>(key));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [actionItem, setActionItem] = useState<Item | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const autoRefreshed = useRef(false);
  useScrollMemory(key, !!state);

  const load = useCallback(async () => {
    try {
      const [page, status, sources] = await Promise.all([api.items(VIEW[filter], { source: sourceId || undefined }), api.status(), api.sources()]);
      const next = { page, status, sources };
      listCache.set(key, next);
      setState(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your inbox.");
    }
  }, [filter, sourceId, key]);

  const refresh = useCallback(
    async (force: boolean) => {
      setRefreshing(true);
      setRefreshNote(null);
      try {
        const r = await api.refresh(force);
        if (force) {
          setRefreshNote(
            r.errors.length
              ? `${r.errors.length} source${r.errors.length > 1 ? "s" : ""} failed to update. See Settings.`
              : r.added
                ? `${r.added} new item${r.added > 1 ? "s" : ""}.`
                : "No new items.",
          );
        }
        await load();
      } catch (e) {
        setRefreshNote(e instanceof Error ? e.message : "Refresh failed.");
      } finally {
        setRefreshing(false);
      }
    },
    [load],
  );

  useEffect(() => {
    sessionStorage.setItem("today-filter", filter);
    sessionStorage.setItem("today-source", String(sourceId));
    setState(listCache.get<State>(key));
    load().then((s) => {
      // Opening the app catches up quietly when the last successful check is stale.
      if (s && !autoRefreshed.current && (!s.status.lastRefreshAt || Date.now() - s.status.lastRefreshAt > STALE_MS || s.status.pending > 0)) {
        autoRefreshed.current = true;
        void refresh(false);
      }
    });
  }, [key]);

  const update = (item: Item) => {
    setState((s) => {
      if (!s) return s;
      const items = s.page.items.map((i) => (i.id === item.id ? item : i)).filter((i) => !i.isHidden);
      const next = { ...s, page: { ...s.page, items } };
      listCache.set(key, next);
      return next;
    });
  };

  const toggleSave = (item: Item) => {
    update({ ...item, isSaved: !item.isSaved });
    void api.setState(item.id, { isSaved: !item.isSaved });
  };

  const loadMore = async () => {
    if (!state?.page.next) return;
    setLoadingMore(true);
    try {
      const more = await api.items(VIEW[filter], { source: sourceId || undefined, before: state.page.next });
      const next = { ...state, page: { items: [...state.page.items, ...more.items], next: more.next } };
      listCache.set(key, next);
      setState(next);
    } finally {
      setLoadingMore(false);
    }
  };

  const sections = useMemo(() => {
    const items = state?.page.items ?? [];
    const today = startOfDay(Date.now());
    const yesterday = today - 86_400_000;
    const groups: { id: string; title: string; items: Item[] }[] = [
      { id: "today", title: "Today", items: items.filter((i) => i.sortTime >= today) },
      { id: "yesterday", title: "Yesterday", items: items.filter((i) => i.sortTime >= yesterday && i.sortTime < today) },
      { id: "earlier", title: filter === "saved" ? "Earlier" : "Earlier unread", items: items.filter((i) => i.sortTime < yesterday) },
    ];
    return groups.filter((g) => g.items.length);
  }, [state, filter]);

  const markSectionRead = async (items: Item[]) => {
    const ids = items.filter((i) => !i.isRead).map((i) => i.id);
    if (!ids.length) return;
    setState((s) => {
      if (!s) return s;
      const set = new Set(ids);
      const next = { ...s, page: { ...s.page, items: s.page.items.map((i) => (set.has(i.id) ? { ...i, isRead: true } : i)) } };
      listCache.set(key, next);
      return next;
    });
    await api.markAllRead(ids);
    void load();
  };

  const newToday = state?.page.items.filter((i) => i.sortTime >= startOfDay(Date.now())).length ?? 0;
  const status = state?.status;

  return (
    <main className="screen" aria-busy={!state}>
      <header className="today-head">
        <div className="today-title-row">
          <h1 className="today-date">{longDate(Date.now())}</h1>
          <button type="button" className="icon-btn" onClick={() => refresh(true)} disabled={refreshing} aria-label="Refresh sources">
            <IconRefresh className={refreshing ? "spin" : undefined} />
          </button>
        </div>
        {status && (
          <p className="today-counts">
            <strong>{newToday} new</strong> · {status.unread} unread
          </p>
        )}
        <p className="today-updated" aria-live="polite">
          {refreshing ? "Checking sources…" : refreshNote ?? (status ? `Updated ${relative(status.lastRefreshAt)}` : "")}
        </p>
      </header>

      <div className="filters" role="toolbar" aria-label="Filter inbox">
        <div className="segmented" role="radiogroup" aria-label="Show">
          {(["all", "unread", "saved"] as Filter[]).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "unread" ? "Unread" : "Saved"}
            </button>
          ))}
        </div>
        <label className="select-wrap">
          <span className="sr-only">Source</span>
          <select value={sourceId} onChange={(e) => setSourceId(Number(e.target.value))}>
            <option value={0}>All sources</option>
            {state?.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {!state && !error && <p className="loading">Loading…</p>}

      {state && sections.length === 0 && (
        <section className="empty">
          <p className="empty-title">{filter === "saved" ? "Nothing saved yet." : "You’re caught up."}</p>
          <p className="empty-sub">Last refresh {relative(state.status.lastRefreshAt)}.</p>
          {state.sources.length === 0 ? (
            <Link className="btn" to="/settings">
              Add your first source
            </Link>
          ) : (
            <Link className="btn btn-quiet" to="/library">
              Browse the Library
            </Link>
          )}
        </section>
      )}

      {sections.map((s) => (
        <section key={s.id} className="day-section" aria-labelledby={`sec-${s.id}`}>
          <div className="section-head">
            <h2 id={`sec-${s.id}`}>
              {s.title} <span className="section-count">{s.items.length}</span>
            </h2>
            {filter !== "saved" && s.items.some((i) => !i.isRead) && (
              <button type="button" className="text-btn" onClick={() => markSectionRead(s.items)}>
                Mark all read
              </button>
            )}
          </div>
          <div className="card-list">
            {s.items.map((item) => (
              <ItemCard key={item.id} item={item} onToggleSave={toggleSave} onMore={setActionItem} showDate={s.id === "earlier"} />
            ))}
          </div>
        </section>
      ))}

      {state?.page.next && (
        <div className="more-row">
          <button type="button" className="btn btn-quiet" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Show older"}
          </button>
        </div>
      )}

      <ItemActions item={actionItem} onClose={() => setActionItem(null)} onChange={update} />
    </main>
  );
}
