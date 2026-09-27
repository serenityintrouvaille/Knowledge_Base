import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, type SearchHit } from "../api";
import { ItemCard } from "../components/ItemCard";

export function Search() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!params.get("q")) input.current?.focus();
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      return;
    }
    setBusy(true);
    const t = window.setTimeout(() => {
      setParams({ q: term }, { replace: true });
      api
        .search(term)
        .then((r) => setHits(r.items))
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 300);
    return () => window.clearTimeout(t);
  }, [q, setParams]);

  return (
    <main className="screen">
      <header className="page-head">
        <h1>Search</h1>
      </header>
      <form role="search" onSubmit={(e) => e.preventDefault()} className="search-form">
        <label className="sr-only" htmlFor="q">
          Search titles, text and sources
        </label>
        <input
          id="q"
          ref={input}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Titles, text, sources…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
      <p className="search-status" aria-live="polite">
        {q.trim().length < 2 ? "Type at least two characters." : busy ? "Searching…" : hits ? `${hits.length}${hits.length === 50 ? "+" : ""} result${hits.length === 1 ? "" : "s"}` : ""}
      </p>
      <div className="card-list">
        {hits?.map((h) => (
          <ItemCard key={h.id} item={h} match={h.match} query={q.trim()} showDate />
        ))}
      </div>
    </main>
  );
}
