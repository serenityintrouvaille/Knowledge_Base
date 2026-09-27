import { Hono } from "hono";
import type { Block, Brief, ItemCard, ItemDetail, Source, Status } from "../shared/types";
import { isSignedIn, login, logout, requireAuth } from "./auth";
import { readingMinutes } from "./brief";
import type { Env } from "./env";
import { addArticle, checkSource, discoverSource, ensureText, runCycle, storeEntries } from "./ingest";

const app = new Hono<{ Bindings: Env }>().basePath("/api");

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "Something went wrong." }, 500);
});

// ---- auth -------------------------------------------------------------------

app.get("/session", async (c) => c.json({ signedIn: await isSignedIn(c) }));

app.post("/login", async (c) => {
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Cross-origin request refused." }, 403);
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: undefined }));
  if (typeof password !== "string" || !password) return c.json({ error: "Enter your password." }, 400);
  const r = await login(c, password);
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, (r.status ?? 401) as 401 | 429);
});

app.post("/logout", (c) => {
  logout(c);
  return c.json({ ok: true });
});

app.use("*", requireAuth);

// ---- items ------------------------------------------------------------------

const CARD_COLUMNS = `i.id, i.source_id, s.name AS source_name, i.title, i.canonical_url, i.author, i.published_at,
  i.discovered_at, i.sort_time, i.content_type, i.image_url, i.preview, i.access_level,
  COALESCE(r.is_read, 0) AS is_read, COALESCE(r.is_saved, 0) AS is_saved, COALESCE(r.is_hidden, 0) AS is_hidden, r.last_opened_at`;
const CARD_FROM = `FROM items i JOIN sources s ON s.id = i.source_id LEFT JOIN reading_state r ON r.item_id = i.id`;

type CardRow = {
  id: number; source_id: number; source_name: string; title: string; canonical_url: string; author: string | null;
  published_at: number | null; discovered_at: number; sort_time: number; content_type: string; image_url: string | null;
  preview: string | null; access_level: ItemCard["accessLevel"]; is_read: number; is_saved: number; is_hidden: number;
  last_opened_at: number | null;
};

function toCard(r: CardRow): ItemCard {
  return {
    id: r.id, sourceId: r.source_id, sourceName: r.source_name, title: r.title, url: r.canonical_url, author: r.author,
    publishedAt: r.published_at, discoveredAt: r.discovered_at, sortTime: r.sort_time, contentType: r.content_type,
    imageUrl: r.image_url, preview: r.preview, accessLevel: r.access_level, isRead: !!r.is_read, isSaved: !!r.is_saved,
    isHidden: !!r.is_hidden, lastOpenedAt: r.last_opened_at,
  };
}

/**
 * view=inbox   unread items plus anything from the last two days (Today)
 * view=all     everything not hidden (Library)
 * view=saved | unread | recent | hidden
 * Paged by sort_time with `before`, never infinite: the client asks for more explicitly.
 */
app.get("/items", async (c) => {
  const view = c.req.query("view") ?? "inbox";
  const sourceId = Number(c.req.query("source") ?? 0);
  const before = Number(c.req.query("before") ?? 0);
  const limit = Math.min(Number(c.req.query("limit") ?? 40) || 40, 100);
  const where: string[] = [];
  const args: unknown[] = [];
  if (view === "hidden") where.push("COALESCE(r.is_hidden, 0) = 1");
  else where.push("COALESCE(r.is_hidden, 0) = 0");
  if (view === "inbox") {
    where.push("(COALESCE(r.is_read, 0) = 0 OR i.sort_time >= ?)");
    args.push(Date.now() - 2 * 86_400_000);
  }
  if (view === "unread") where.push("COALESCE(r.is_read, 0) = 0");
  if (view === "saved") where.push("r.is_saved = 1");
  if (view === "recent") where.push("r.last_opened_at IS NOT NULL");
  if (sourceId) {
    where.push("i.source_id = ?");
    args.push(sourceId);
  }
  const order = view === "recent" ? "r.last_opened_at" : "i.sort_time";
  if (before) {
    where.push(`${order} < ?`);
    args.push(before);
  }
  const { results } = await c.env.DB.prepare(`SELECT ${CARD_COLUMNS} ${CARD_FROM} WHERE ${where.join(" AND ")} ORDER BY ${order} DESC LIMIT ?`)
    .bind(...args, limit + 1).all<CardRow>();
  const items = results.slice(0, limit).map(toCard);
  const last = items.at(-1);
  const next = results.length > limit && last ? (view === "recent" ? last.lastOpenedAt : last.sortTime) : null;
  return c.json({ items, next });
});

app.get("/items/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await ensureText(c.env, id).catch((e) => console.warn("on-demand fetch failed", e));
  const row = await c.env.DB.prepare(
    `SELECT ${CARD_COLUMNS}, i.blocks, i.excerpt, i.permitted_text, i.text_status, r.reading_position,
       m.body AS brief_body, m.method, m.source_scope, m.status AS brief_status, m.generated_at
     ${CARD_FROM} LEFT JOIN summaries m ON m.item_id = i.id WHERE i.id = ?`,
  ).bind(id).first<CardRow & {
    blocks: string | null; excerpt: string | null; permitted_text: string | null; text_status: string; reading_position: number | null;
    brief_body: string | null; method: Brief["method"] | null; source_scope: Brief["scope"]; brief_status: Brief["status"]; generated_at: number;
  }>();
  if (!row) return c.json({ error: "Not found." }, 404);
  const detail: ItemDetail = {
    ...toCard(row),
    blocks: row.blocks ? (JSON.parse(row.blocks) as Block[]) : [],
    excerpt: row.excerpt,
    brief: row.method
      ? { paragraphs: JSON.parse(row.brief_body ?? "[]"), method: row.method, scope: row.source_scope, status: row.brief_status, generatedAt: row.generated_at }
      : null,
    readingMinutes: row.permitted_text ? readingMinutes(row.permitted_text) : null,
    readingPosition: row.reading_position,
    textStatus: row.text_status,
  };
  return c.json(detail);
});

app.patch("/items/:id/state", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ isRead?: boolean; isSaved?: boolean; isHidden?: boolean; readingPosition?: number; opened?: boolean }>();
  const sets: string[] = [];
  const args: unknown[] = [];
  const flag = (col: string, v: boolean | undefined) => {
    if (typeof v === "boolean") {
      sets.push(`${col} = ?`);
      args.push(v ? 1 : 0);
    }
  };
  flag("is_read", body.isRead);
  flag("is_saved", body.isSaved);
  flag("is_hidden", body.isHidden);
  if (typeof body.readingPosition === "number" && body.readingPosition >= 0 && body.readingPosition <= 1) {
    sets.push("reading_position = ?");
    args.push(body.readingPosition);
  }
  if (body.opened) {
    sets.push("last_opened_at = ?");
    args.push(Date.now());
  }
  if (!sets.length) return c.json({ error: "Nothing to update." }, 400);
  await c.env.DB.prepare(`INSERT OR IGNORE INTO reading_state (item_id) SELECT id FROM items WHERE id = ?`).bind(id).run();
  await c.env.DB.prepare(`UPDATE reading_state SET ${sets.join(", ")} WHERE item_id = ?`).bind(...args, id).run();
  return c.json({ ok: true });
});

app.post("/items/read-all", async (c) => {
  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!Array.isArray(ids) || !ids.length) return c.json({ ok: true });
  const safe = ids.slice(0, 200).map(Number).filter(Number.isInteger);
  await c.env.DB.batch(
    safe.map((id) =>
      c.env.DB.prepare(`INSERT INTO reading_state (item_id, is_read) VALUES (?, 1) ON CONFLICT(item_id) DO UPDATE SET is_read = 1`).bind(id),
    ),
  );
  return c.json({ ok: true });
});

app.post("/items/:id/report", async (c) => {
  const id = Number(c.req.param("id"));
  const { note } = await c.req.json<{ note?: string }>().catch(() => ({ note: "" }));
  await c.env.DB.prepare("UPDATE summaries SET status = 'reported', report_note = ? WHERE item_id = ?").bind((note ?? "").slice(0, 1000), id).run();
  return c.json({ ok: true });
});

app.post("/articles", async (c) => {
  const { url } = await c.req.json<{ url?: string }>();
  if (!url) return c.json({ error: "Paste a link." }, 400);
  try {
    return c.json({ id: await addArticle(c.env, url) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Could not add that link." }, 400);
  }
});

// ---- search -----------------------------------------------------------------

app.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return c.json({ items: [] });
  // LIKE rather than FTS: FTS5's default tokenizer can't match Korean words inside
  // particles ("서울" vs "서울에서"), and a personal library is small enough to scan.
  const like = `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT ${CARD_COLUMNS}, i.permitted_text, i.excerpt ${CARD_FROM}
     WHERE i.title LIKE ?1 ESCAPE '\\' OR i.permitted_text LIKE ?1 ESCAPE '\\' OR i.excerpt LIKE ?1 ESCAPE '\\'
        OR s.name LIKE ?1 ESCAPE '\\' OR i.author LIKE ?1 ESCAPE '\\'
     ORDER BY (i.title LIKE ?1 ESCAPE '\\') DESC, i.sort_time DESC LIMIT 50`,
  ).bind(like).all<CardRow & { permitted_text: string | null; excerpt: string | null }>();
  const needle = q.toLowerCase();
  const items = results.map((r) => {
    const text = r.permitted_text ?? r.excerpt ?? "";
    const at = text.toLowerCase().indexOf(needle);
    const match = at >= 0 ? (at > 60 ? "…" : "") + text.slice(Math.max(0, at - 60), at + q.length + 100).replace(/\s+/g, " ") + "…" : null;
    return { ...toCard(r), match };
  });
  return c.json({ items });
});

// ---- sources ----------------------------------------------------------------

type SourceRow = {
  id: number; name: string; url: string; feed_url: string | null; type: Source["type"]; icon_url: string | null; category: string | null;
  enabled: number; check_frequency: number; last_checked_at: number | null; last_success_at: number | null; last_error: string | null;
  item_count: number; saved_count: number;
};

function toSource(r: SourceRow): Source {
  return {
    id: r.id, name: r.name, url: r.url, feedUrl: r.feed_url, type: r.type, iconUrl: r.icon_url, category: r.category,
    enabled: !!r.enabled, checkFrequency: r.check_frequency, lastCheckedAt: r.last_checked_at, lastSuccessAt: r.last_success_at,
    lastError: r.last_error, itemCount: r.item_count, savedCount: r.saved_count,
  };
}

const SOURCE_SELECT = `SELECT s.*,
  (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id) AS item_count,
  (SELECT COUNT(*) FROM items i JOIN reading_state r ON r.item_id = i.id WHERE i.source_id = s.id AND r.is_saved = 1) AS saved_count
  FROM sources s`;

app.get("/sources", async (c) => {
  const { results } = await c.env.DB.prepare(`${SOURCE_SELECT} ORDER BY s.type = 'manual', s.name COLLATE NOCASE`).all<SourceRow>();
  return c.json(results.map(toSource));
});

app.post("/sources", async (c) => {
  const { url } = await c.req.json<{ url?: string }>();
  if (!url) return c.json({ error: "Paste a feed, blog or publication link." }, 400);
  let found;
  try {
    found = await discoverSource(url);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Could not add that source." }, 400);
  }
  // A Substack on a custom domain has two feed URLs for one publication; match on the site too.
  const exists = await c.env.DB.prepare("SELECT id FROM sources WHERE feed_url = ? OR (url = ? AND type != 'manual')").bind(found.feedUrl, found.url).first<{ id: number }>();
  if (exists) return c.json({ error: `Already following ${found.name}.` }, 409);
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `INSERT INTO sources (name, url, feed_url, type, icon_url, enabled, check_frequency, created_at) VALUES (?, ?, ?, ?, ?, 1, 6, ?) RETURNING id`,
  ).bind(found.name.slice(0, 200), found.url, found.feedUrl, found.type, found.iconUrl, now).first<{ id: number }>();
  const source = { id: row!.id, type: found.type, feed_url: found.feedUrl, last_success_at: null };
  // Store what the discovery fetch already returned instead of fetching the feed twice.
  const added = await storeEntries(c.env, source, found.feed);
  await c.env.DB.prepare("UPDATE sources SET last_checked_at = ?, last_success_at = ? WHERE id = ?").bind(now, now, row!.id).run();
  const created = await c.env.DB.prepare(`${SOURCE_SELECT} WHERE s.id = ?`).bind(row!.id).first<SourceRow>();
  return c.json({ source: toSource(created!), added });
});

app.patch("/sources/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ name?: string; enabled?: boolean; checkFrequency?: number; category?: string | null }>();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (typeof body.name === "string" && body.name.trim()) {
    sets.push("name = ?");
    args.push(body.name.trim().slice(0, 200));
  }
  if (typeof body.enabled === "boolean") {
    sets.push("enabled = ?");
    args.push(body.enabled ? 1 : 0);
  }
  if (typeof body.checkFrequency === "number" && [3, 6, 12, 24].includes(body.checkFrequency)) {
    sets.push("check_frequency = ?");
    args.push(body.checkFrequency);
  }
  if (body.category !== undefined) {
    sets.push("category = ?");
    args.push(body.category ? String(body.category).slice(0, 60) : null);
  }
  if (!sets.length) return c.json({ error: "Nothing to update." }, 400);
  await c.env.DB.prepare(`UPDATE sources SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id).run();
  return c.json({ ok: true });
});

app.delete("/sources/:id", async (c) => {
  const id = Number(c.req.param("id"));
  // Items, briefs and reading state cascade with the source. The UI confirms first.
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM summaries WHERE item_id IN (SELECT id FROM items WHERE source_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM reading_state WHERE item_id IN (SELECT id FROM items WHERE source_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM items WHERE source_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM sources WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

app.post("/sources/:id/refresh", async (c) => {
  const id = Number(c.req.param("id"));
  const source = await c.env.DB.prepare("SELECT id, type, feed_url, last_success_at FROM sources WHERE id = ?").bind(id).first<{
    id: number; type: Source["type"]; feed_url: string | null; last_success_at: number | null;
  }>();
  if (!source) return c.json({ error: "Not found." }, 404);
  return c.json(await checkSource(c.env, source));
});

// ---- refresh & status -------------------------------------------------------

app.post("/refresh", async (c) => {
  const { force } = await c.req.json<{ force?: boolean }>().catch(() => ({ force: false }));
  return c.json(await runCycle(c.env, { force: !!force, itemLimit: 4 }));
});

app.get("/status", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT (SELECT MAX(last_success_at) FROM sources) AS last_refresh,
       (SELECT COUNT(*) FROM items i LEFT JOIN reading_state r ON r.item_id = i.id WHERE COALESCE(r.is_read,0) = 0 AND COALESCE(r.is_hidden,0) = 0) AS unread,
       (SELECT COUNT(*) FROM items WHERE text_status = 'pending') AS pending,
       (SELECT COUNT(*) FROM items) AS total`,
  ).first<{ last_refresh: number | null; unread: number; pending: number; total: number }>();
  const status: Status = { lastRefreshAt: row?.last_refresh ?? null, unread: row?.unread ?? 0, pending: row?.pending ?? 0, total: row?.total ?? 0 };
  return c.json(status);
});

// ---- export -----------------------------------------------------------------

app.get("/export", async (c) => {
  const [sources, items, summaries, states] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM sources").all(),
    c.env.DB.prepare(
      "SELECT id, source_id, canonical_url, external_id, title, author, published_at, discovered_at, content_type, image_url, excerpt, blocks, access_level, content_hash FROM items",
    ).all(),
    c.env.DB.prepare("SELECT * FROM summaries").all(),
    c.env.DB.prepare("SELECT * FROM reading_state").all(),
  ]);
  const body = JSON.stringify({
    format: "daily-archive-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    sources: sources.results,
    items: items.results,
    summaries: summaries.results,
    readingState: states.results,
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="daily-archive-${date}.json"` },
  });
});

app.all("*", (c) => c.json({ error: "Not found." }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runCycle(env).then((r) => {
        if (r.checked || r.processed) console.log("cycle", JSON.stringify(r));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
