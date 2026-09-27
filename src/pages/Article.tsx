import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { Block, ItemDetail } from "../../shared/types";
import { api } from "../api";
import { listCache } from "../cache";
import { IconBack, IconBookmark, IconExternal, IconMore, IconType } from "../components/Icons";
import { Sheet } from "../components/Sheet";
import { ACCESS_LABEL, fullDateTime } from "../format";
import { FONT_SIZES, usePrefs, type Theme } from "../prefs";

function BlockView({ block }: { block: Block }) {
  switch (block.t) {
    case "h":
      return <h3 className="body-h">{block.text}</h3>;
    case "quote":
      return <blockquote>{block.text}</blockquote>;
    case "li":
      return <p className="body-li">{block.text}</p>;
    case "pre":
      return <pre>{block.text}</pre>;
    case "img":
      return (
        <img
          className="body-img"
          src={block.src}
          alt={block.alt ?? ""}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => ((e.currentTarget as HTMLImageElement).hidden = true)}
        />
      );
    default:
      return <p>{block.text}</p>;
  }
}

function excerptBlocks(excerpt: string | null): Block[] {
  return (excerpt ?? "").split(/\n+/).filter((t) => t.trim()).map((text) => ({ t: "p", text }));
}

function sourceHost(url: string): string {
  const host = new URL(url).hostname.replace(/^(www|m)\./, "");
  if (host.endsWith("naver.com")) return "Naver";
  if (host.endsWith("substack.com")) return "Substack";
  if (host === "t.me" || host === "telegram.me") return "Telegram";
  return host;
}

export function Article() {
  const { id } = useParams();
  const itemId = Number(id);
  const navigate = useNavigate();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNote, setReportNote] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [prefs, setPrefs] = usePrefs();
  const restored = useRef(false);
  const lastSaved = useRef(0);

  useEffect(() => {
    let alive = true;
    restored.current = false;
    window.scrollTo(0, 0);
    api
      .item(itemId)
      .then((d) => {
        if (!alive) return;
        setItem(d);
        listCache.clear(); // read/saved state changed; lists refetch on return
        void api.setState(itemId, { isRead: true, opened: true });
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load this item."));
    return () => {
      alive = false;
    };
  }, [itemId]);

  // Restore reading position once, then remember it as the reader scrolls.
  useEffect(() => {
    if (!item || restored.current) return;
    restored.current = true;
    const pos = item.readingPosition ?? 0;
    if (pos > 0.03 && pos < 0.97) {
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, pos * max);
      });
    }
    let timer: number | undefined;
    const save = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      const ratio = Math.min(1, Math.max(0, window.scrollY / max));
      if (Math.abs(ratio - lastSaved.current) < 0.02) return;
      lastSaved.current = ratio;
      void api.setState(item.id, { readingPosition: Number(ratio.toFixed(3)) }).catch(() => {});
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 800);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer);
      save();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
    };
  }, [item]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const patch = async (p: { isRead?: boolean; isSaved?: boolean; isHidden?: boolean }, msg?: string) => {
    if (!item) return;
    setItem({ ...item, ...p });
    await api.setState(item.id, p);
    if (msg) flash(msg);
  };

  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/"));

  const share = async () => {
    if (!item) return;
    setMenuOpen(false);
    try {
      if (navigator.share) await navigator.share({ title: item.title, url: item.url });
      else {
        await navigator.clipboard.writeText(item.url);
        flash("Link copied");
      }
    } catch {
      // share sheet dismissed
    }
  };

  const submitReport = async () => {
    if (!item) return;
    await api.report(item.id, reportNote);
    setItem({ ...item, brief: item.brief ? { ...item.brief, status: "reported" } : null });
    setReportOpen(false);
    setReportNote("");
    flash("Thanks — brief marked as inaccurate");
  };

  if (error) {
    return (
      <main className="screen article-screen">
        <button type="button" className="icon-btn" onClick={back} aria-label="Back">
          <IconBack />
        </button>
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      </main>
    );
  }

  const brief = item?.brief;
  const isFull = item?.accessLevel === "full";
  const host = item ? sourceHost(item.url) : "";

  return (
    <>
      <div className="article-bar">
        <button type="button" className="icon-btn" onClick={back} aria-label="Back">
          <IconBack />
        </button>
        <div className="article-bar-actions">
          <button type="button" className="icon-btn" onClick={() => setTypeOpen(true)} aria-label="Text size and theme">
            <IconType />
          </button>
          {item && (
            <button
              type="button"
              className="icon-btn"
              aria-pressed={item.isSaved}
              aria-label={item.isSaved ? "Remove from saved" : "Save"}
              onClick={() => patch({ isSaved: !item.isSaved }, item.isSaved ? "Removed from saved" : "Saved")}
            >
              <IconBookmark filled={item.isSaved} />
            </button>
          )}
          <button type="button" className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="More actions" disabled={!item}>
            <IconMore />
          </button>
        </div>
      </div>

      <main className="screen article-screen" aria-busy={!item}>
        {!item && <p className="loading">Loading…</p>}
        {item && (
          <article className="reader">
            <header className="reader-head">
              <p className="reader-source">{item.sourceName}</p>
              <h1 className="reader-title">{item.title}</h1>
              <p className="reader-meta">
                {item.author && <span>{item.author} · </span>}
                <time dateTime={new Date(item.sortTime).toISOString()}>{fullDateTime(item.sortTime)}</time>
                {item.publishedAt == null && <span> (date found, not published)</span>}
                {item.readingMinutes && <span> · {item.readingMinutes} min read</span>}
              </p>
              <div className="reader-badges">
                <span className={`chip chip-${item.accessLevel}`}>{ACCESS_LABEL[item.accessLevel]}</span>
                <a className="btn btn-small" href={item.url} target="_blank" rel="noopener noreferrer">
                  Open on {host} <IconExternal />
                </a>
              </div>
            </header>

            {isFull && (!brief || brief.status === "unavailable") ? (
              <p className="brief-short">Short post: the full text is below, so there’s no brief.</p>
            ) : (
            <section className="brief" aria-labelledby="brief-h">
              <h2 id="brief-h" className="brief-h">
                The brief
              </h2>
              {brief?.status !== "unavailable" && brief && brief.paragraphs.length > 0 ? (
                <>
                  <p className="brief-label">
                    Basic brief: key passages in the author’s own words, picked automatically. Not an AI summary.
                    {brief.scope === "excerpt" && " Based on an excerpt only, so it may not represent the whole piece."}
                  </p>
                  {brief.paragraphs.map((p, i) => (
                    <p key={i} className="brief-p">
                      {p}
                    </p>
                  ))}
                  {brief.status === "reported" && <p className="brief-flag">You marked this brief as inaccurate.</p>}
                </>
              ) : (
                <p className="brief-label">
                  {item.textStatus === "pending"
                    ? "Summary pending: the full text hasn’t been fetched yet. It’s queued for the next update."
                    : "Summary unavailable: there wasn’t enough text to brief honestly."}
                  {item.excerpt && !isFull ? " The available excerpt is below." : ""}
                </p>
              )}
            </section>
            )}

            <section className="reader-body" aria-label={isFull ? "Original text" : "Excerpt"}>
              <h2 className="body-label">{isFull ? "Original text" : item.accessLevel === "excerpt" ? "Excerpt" : "No text available"}</h2>
              {(item.blocks.length ? item.blocks : excerptBlocks(item.excerpt)).map((b, i) => (
                <BlockView key={i} block={b} />
              ))}
              {!isFull && (
                <p className="excerpt-note">
                  This is only part of the piece.{" "}
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    Read the full post on {host}
                  </a>
                  .
                </p>
              )}
            </section>

            <footer className="reader-foot">
              <a className="btn" href={item.url} target="_blank" rel="noopener noreferrer">
                Open original <IconExternal />
              </a>
              <button type="button" className="btn btn-quiet" onClick={() => patch({ isRead: false }, "Marked as unread")}>
                Mark unread
              </button>
            </footer>
          </article>
        )}
      </main>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Article actions">
        {item && (
          <>
            <button type="button" className="sheet-btn" onClick={share}>
              Share original link
            </button>
            <button
              type="button"
              className="sheet-btn"
              onClick={() => {
                setMenuOpen(false);
                void patch({ isRead: false }, "Marked as unread");
              }}
            >
              Mark as unread
            </button>
            {brief && brief.paragraphs.length > 0 && (
              <button
                type="button"
                className="sheet-btn"
                onClick={() => {
                  setMenuOpen(false);
                  setReportOpen(true);
                }}
              >
                Report inaccurate brief
              </button>
            )}
            <button
              type="button"
              className="sheet-btn"
              onClick={() => {
                setMenuOpen(false);
                void patch({ isHidden: !item.isHidden }, item.isHidden ? "Back in the inbox" : "Hidden from inbox");
              }}
            >
              {item.isHidden ? "Unhide" : "Hide from inbox"}
            </button>
          </>
        )}
      </Sheet>

      <Sheet open={typeOpen} onClose={() => setTypeOpen(false)} title="Reading settings">
        <div className="type-row" role="group" aria-label="Text size">
          <button type="button" className="btn btn-quiet" onClick={() => setPrefs({ fontStep: Math.max(0, prefs.fontStep - 1) })} disabled={prefs.fontStep <= 0} aria-label="Smaller text">
            A−
          </button>
          <span className="type-size" aria-live="polite">
            {FONT_SIZES[prefs.fontStep]} px
          </span>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setPrefs({ fontStep: Math.min(FONT_SIZES.length - 1, prefs.fontStep + 1) })}
            disabled={prefs.fontStep >= FONT_SIZES.length - 1}
            aria-label="Larger text"
          >
            A+
          </button>
        </div>
        <div className="segmented segmented-full" role="radiogroup" aria-label="Theme">
          {(["system", "light", "dark"] as Theme[]).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={prefs.theme === t} onClick={() => setPrefs({ theme: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={reportOpen} onClose={() => setReportOpen(false)} title="Report inaccurate brief">
        <label className="field">
          <span>What’s wrong? (optional, for your own reference)</span>
          <textarea rows={3} value={reportNote} onChange={(e) => setReportNote(e.target.value)} />
        </label>
        <button type="button" className="sheet-btn sheet-primary" onClick={submitReport}>
          Mark as inaccurate
        </button>
      </Sheet>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
