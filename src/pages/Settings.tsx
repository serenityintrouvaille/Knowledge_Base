import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { Source, Status } from "../../shared/types";
import { api } from "../api";
import { listCache } from "../cache";
import { IconAlert, IconCheck, IconRefresh } from "../components/Icons";
import { Sheet } from "../components/Sheet";
import { relative } from "../format";
import { FONT_SIZES, usePrefs, type Theme } from "../prefs";

const TYPE_LABEL: Record<Source["type"], string> = { naver: "Naver blog", substack: "Substack", feed: "Feed", manual: "Added by hand" };

function SourceRow({ source, onChanged, onEdit }: { source: Source; onChanged: () => void; onEdit: (s: Source) => void }) {
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try {
      await api.refreshSource(source.id);
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  return (
    <li className={`source${source.enabled ? "" : " is-paused"}`}>
      <button type="button" className="source-main" onClick={() => onEdit(source)} aria-label={`Edit ${source.name}`}>
        <span className="source-name">{source.name}</span>
        <span className="source-sub">
          {TYPE_LABEL[source.type]} · {source.itemCount} items{!source.enabled && " · Paused"}
        </span>
        {source.type !== "manual" && (
          <span className={`source-status${source.lastError ? " is-error" : ""}`}>
            {source.lastError ? (
              <>
                <IconAlert /> Last check failed {relative(source.lastCheckedAt)}: {source.lastError}
              </>
            ) : (
              <>
                <IconCheck /> Checked {relative(source.lastCheckedAt)} · every {source.checkFrequency} h
              </>
            )}
          </span>
        )}
      </button>
      {source.type !== "manual" && (
        <button type="button" className="icon-btn" onClick={refresh} disabled={busy} aria-label={`Refresh ${source.name} now`}>
          <IconRefresh className={busy ? "spin" : undefined} />
        </button>
      )}
    </li>
  );
}

export function Settings({ onSignedOut }: { onSignedOut: () => void }) {
  const navigate = useNavigate();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string; where: "source" | "article" } | null>(null);
  const [busy, setBusy] = useState<"source" | "article" | "refresh" | null>(null);
  const [editing, setEditing] = useState<Source | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [prefs, setPrefs] = usePrefs();

  const load = useCallback(async () => {
    const [s, st] = await Promise.all([api.sources(), api.status()]);
    setSources(s);
    setStatus(st);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addSource = async (e: FormEvent) => {
    e.preventDefault();
    if (!feedUrl.trim()) return;
    setBusy("source");
    setMsg(null);
    try {
      const r = await api.addSource(feedUrl.trim());
      setMsg({ kind: "ok", where: "source", text: `Following ${r.source.name}. ${r.added} items found; the last week’s are in Today.` });
      setFeedUrl("");
      listCache.clear();
      await load();
    } catch (err) {
      setMsg({ kind: "error", where: "source", text: err instanceof Error ? err.message : "Could not add that source." });
    } finally {
      setBusy(null);
    }
  };

  const addArticle = async (e: FormEvent) => {
    e.preventDefault();
    if (!articleUrl.trim()) return;
    setBusy("article");
    setMsg(null);
    try {
      const r = await api.addArticle(articleUrl.trim());
      setArticleUrl("");
      listCache.clear();
      navigate(`/item/${r.id}`);
    } catch (err) {
      setMsg({ kind: "error", where: "article", text: err instanceof Error ? err.message : "Could not add that link." });
    } finally {
      setBusy(null);
    }
  };

  const refreshAll = async () => {
    setBusy("refresh");
    try {
      await api.refresh(true);
      listCache.clear();
    } finally {
      setBusy(null);
      await load();
    }
  };

  const openEdit = (s: Source) => {
    setEditing(s);
    setEditName(s.name);
    setConfirmDelete(false);
  };

  const saveEdit = async (patch: { name?: string; enabled?: boolean; checkFrequency?: number }) => {
    if (!editing) return;
    await api.updateSource(editing.id, patch);
    setEditing({ ...editing, ...patch });
    listCache.clear();
    await load();
  };

  const remove = async () => {
    if (!editing) return;
    await api.deleteSource(editing.id);
    setEditing(null);
    listCache.clear();
    await load();
  };

  const signOut = async () => {
    await api.logout().catch(() => {});
    listCache.clear();
    onSignedOut();
  };

  const failing = sources?.filter((s) => s.lastError).length ?? 0;

  return (
    <main className="screen">
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <section className="panel" aria-labelledby="h-sources">
        <h2 id="h-sources">Sources</h2>
        {failing > 0 && (
          <p className="notice notice-error">
            <IconAlert /> {failing} source{failing > 1 ? "s" : ""} failed on the last check. Other sources keep updating.
          </p>
        )}
        {sources && sources.length === 0 && <p className="muted">No sources yet. Add a blog or publication below.</p>}
        <ul className="source-list">
          {sources?.map((s) => <SourceRow key={s.id} source={s} onChanged={load} onEdit={openEdit} />)}
        </ul>

        <form className="add-form" onSubmit={addSource}>
          <label className="field">
            <span>Follow a source</span>
            <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="Naver blog, Substack, or any site with a feed" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} />
          </label>
          <button type="submit" className="btn" disabled={busy === "source" || !feedUrl.trim()}>
            {busy === "source" ? "Looking for a feed…" : "Follow"}
          </button>
        </form>
        {msg?.where === "source" && (
          <p className={`notice notice-${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}>
            {msg.text}
          </p>
        )}

        <form className="add-form" onSubmit={addArticle}>
          <label className="field">
            <span>Add a single article</span>
            <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://…" value={articleUrl} onChange={(e) => setArticleUrl(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-quiet" disabled={busy === "article" || !articleUrl.trim()}>
            {busy === "article" ? "Fetching…" : "Add"}
          </button>
        </form>
        {msg?.where === "article" && (
          <p className={`notice notice-${msg.kind}`} role="alert">
            {msg.text}
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="h-refresh">
        <h2 id="h-refresh">Updates</h2>
        <p className="muted">
          Sources are checked automatically every few hours. Last successful check {relative(status?.lastRefreshAt ?? null)}.
          {status && status.pending > 0 && ` ${status.pending} item${status.pending > 1 ? "s" : ""} waiting for full text.`}
          {status && ` ${status.total} items stored.`}
        </p>
        <button type="button" className="btn btn-quiet" onClick={refreshAll} disabled={busy === "refresh"}>
          {busy === "refresh" ? "Checking…" : "Check all sources now"}
        </button>
      </section>

      <section className="panel" aria-labelledby="h-look">
        <h2 id="h-look">Appearance</h2>
        <div className="segmented segmented-full" role="radiogroup" aria-label="Theme">
          {(["system", "light", "dark"] as Theme[]).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={prefs.theme === t} onClick={() => setPrefs({ theme: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Article text size: {FONT_SIZES[prefs.fontStep]} px</span>
          <input type="range" min={0} max={FONT_SIZES.length - 1} step={1} value={prefs.fontStep} onChange={(e) => setPrefs({ fontStep: Number(e.target.value) })} />
        </label>
      </section>

      <section className="panel" aria-labelledby="h-data">
        <h2 id="h-data">Your data</h2>
        <p className="muted">Download your sources, items, briefs and reading state as JSON.</p>
        <a className="btn btn-quiet" href="/api/export" download>
          Export JSON
        </a>
      </section>

      <section className="panel" aria-labelledby="h-about">
        <h2 id="h-about">About briefs</h2>
        <p className="muted">
          Briefs are built without AI: they’re the most representative sentences from the text this site can access, kept in the author’s words and
          original order. Naver posts are fetched once, for your own reading. Paid Substack posts show only their public preview.
        </p>
      </section>

      <section className="panel">
        <button type="button" className="btn btn-quiet" onClick={signOut}>
          Sign out
        </button>
      </section>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.name ?? "Source"}>
        {editing && (
          <div className="edit-source">
            <label className="field">
              <span>Name</span>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </label>
            <button type="button" className="sheet-btn" onClick={() => saveEdit({ name: editName })} disabled={!editName.trim() || editName === editing.name}>
              Save name
            </button>
            {editing.type !== "manual" && (
              <>
                <label className="field">
                  <span>Check every</span>
                  <select value={editing.checkFrequency} onChange={(e) => saveEdit({ checkFrequency: Number(e.target.value) })}>
                    {[3, 6, 12, 24].map((h) => (
                      <option key={h} value={h}>
                        {h} hours
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="sheet-btn" onClick={() => saveEdit({ enabled: !editing.enabled })}>
                  {editing.enabled ? "Pause updates" : "Resume updates"}
                </button>
                <a className="sheet-btn" href={editing.url} target="_blank" rel="noopener noreferrer">
                  Open site
                </a>
              </>
            )}
            {!confirmDelete ? (
              <button type="button" className="sheet-btn sheet-danger" onClick={() => setConfirmDelete(true)}>
                Remove source…
              </button>
            ) : (
              <div className="confirm">
                <p>
                  Remove <strong>{editing.name}</strong> and its {editing.itemCount} items
                  {editing.savedCount > 0 && <>, including {editing.savedCount} saved</>}? This can’t be undone.
                </p>
                <button type="button" className="sheet-btn sheet-danger" onClick={remove}>
                  Yes, remove permanently
                </button>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </main>
  );
}
