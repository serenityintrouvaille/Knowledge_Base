import { useCallback, useEffect, useState } from "react";
import type { ItemCard as Item, Source } from "../../shared/types";
import { api, type ItemView, type Page } from "../api";
import { listCache, useScrollMemory } from "../cache";
import { ItemActions } from "../components/ItemActions";
import { ItemCard } from "../components/ItemCard";

const TABS: { id: ItemView; label: string }[] = [
  { id: "saved", label: "Saved" },
  { id: "all", label: "All" },
  { id: "recent", label: "Recently opened" },
  { id: "hidden", label: "Hidden" },
];

export function Library() {
  const [tab, setTab] = useState<ItemView>(() => (sessionStorage.getItem("library-tab") as ItemView) || "saved");
  const [sourceId, setSourceId] = useState(0);
  const key = `library:${tab}:${sourceId}`;
  const [page, setPage] = useState<Page | undefined>(() => listCache.get<Page>(key));
  const [sources, setSources] = useState<Source[]>([]);
  const [actionItem, setActionItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  useScrollMemory(key, !!page);

  const load = useCallback(async () => {
    try {
      const p = await api.items(tab, { source: sourceId || undefined });
      listCache.set(key, p);
      setPage(p);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the library.");
    }
  }, [tab, sourceId, key]);

  useEffect(() => {
    sessionStorage.setItem("library-tab", tab);
    setPage(listCache.get<Page>(key));
    void load();
  }, [key, load, tab]);

  useEffect(() => {
    api.sources().then(setSources).catch(() => {});
  }, []);

  const update = (item: Item) =>
    setPage((p) => {
      if (!p) return p;
      const keep = (i: Item) => (tab === "saved" ? i.isSaved : tab === "hidden" ? i.isHidden : !i.isHidden);
      const next = { ...p, items: p.items.map((i) => (i.id === item.id ? item : i)).filter(keep) };
      listCache.set(key, next);
      return next;
    });

  const more = async () => {
    if (!page?.next) return;
    const m = await api.items(tab, { source: sourceId || undefined, before: page.next });
    const next = { items: [...page.items, ...m.items], next: m.next };
    listCache.set(key, next);
    setPage(next);
  };

  return (
    <main className="screen">
      <header className="page-head">
        <h1>Library</h1>
      </header>
      <div className="tabs" role="tablist" aria-label="Library views">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="filters">
        <label className="select-wrap select-full">
          <span className="sr-only">Source</span>
          <select value={sourceId} onChange={(e) => setSourceId(Number(e.target.value))}>
            <option value={0}>All sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.itemCount})
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
      {!page && !error && <p className="loading">Loading…</p>}
      {page && page.items.length === 0 && (
        <section className="empty">
          <p className="empty-title">
            {tab === "saved" ? "Nothing saved yet." : tab === "recent" ? "You haven’t opened anything yet." : tab === "hidden" ? "Nothing hidden." : "No items yet."}
          </p>
          {tab === "saved" && <p className="empty-sub">Tap the bookmark on any item to keep it here.</p>}
        </section>
      )}
      <div className="card-list">
        {page?.items.map((item) => (
          <ItemCard key={item.id} item={item} showDate onToggleSave={(i) => {
            update({ ...i, isSaved: !i.isSaved });
            void api.setState(i.id, { isSaved: !i.isSaved });
          }} onMore={setActionItem} />
        ))}
      </div>
      {page?.next && (
        <div className="more-row">
          <button type="button" className="btn btn-quiet" onClick={more}>
            Show more
          </button>
        </div>
      )}
      <ItemActions item={actionItem} onClose={() => setActionItem(null)} onChange={update} />
    </main>
  );
}
