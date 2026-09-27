// Source discovery, feed checks and the per-item text pipeline.
//
// Free Workers get ~10 ms of CPU per invocation, so work is split: a feed check only
// parses XML and inserts rows (raw HTML is parked in items.raw_html), and each cron
// run then extracts text and builds briefs for a few queued items.

import type { Block, SourceType } from "../shared/types";
import { buildBrief, previewSentence } from "./brief";
import type { Env } from "./env";
import { blocksToText, extractGeneric, extractNaver, fetchText, inspectPage } from "./extract";
import { htmlToText, isFeedDocument, isTruncatedPreview, parseFeed, type ParsedFeed } from "./feed";
import { oldestPostNumber, parseTelegram, parseTelegramPage, telegramFeedUrl } from "./telegram";
import { canonicalUrl, parseNaver, validatePublicUrl } from "./urls";

const DAY = 86_400_000;
const FIRST_SYNC_UNREAD_DAYS = 7; // older items from a newly added source start as read
const FULLTEXT_BACKFILL_DAYS = 14; // older items fetch full text only when opened
const MAX_ATTEMPTS = 3;
const MAX_TEXT = 200_000;
const SMALL_INLINE_HTML = 20_000;
const INLINE_PER_RUN = 12;
const PAYWALL = /(this post is for paid subscribers|keep reading with a 7-day free trial|subscribe to .{1,60} to (read|keep reading|unlock)|upgrade to paid|유료 구독자)/i;

export interface Discovered {
  name: string;
  url: string;
  feedUrl: string;
  type: SourceType;
  iconUrl: string | null;
  feed: ParsedFeed;
}

async function loadFeed(feedUrl: string): Promise<{ xml: string; feed: ParsedFeed }> {
  const { body } = await fetchText(feedUrl, { accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5" });
  if (!isFeedDocument(body)) throw new Error("The feed URL did not return RSS or Atom.");
  return { xml: body, feed: parseFeed(body) };
}

async function loadTelegram(feedUrl: string): Promise<ParsedFeed> {
  const channel = parseTelegram(feedUrl);
  if (!channel) throw new Error("Not a Telegram channel link.");
  const { body } = await fetchText(feedUrl);
  return parseTelegramPage(body, channel);
}

function loadSourceFeed(type: SourceType, feedUrl: string): Promise<ParsedFeed> {
  return type === "telegram" ? loadTelegram(feedUrl) : loadFeed(feedUrl).then((r) => r.feed);
}

/** Card preview for a Telegram post: its first line is already the title, so skip it. */
function telegramPreview(text: string | null): string | null {
  if (!text) return null;
  const rest = text.split("\n").slice(1).join("\n").trim();
  return rest ? previewSentence(rest) : null;
}

/** Resolve whatever the user pasted (blog page, post, publication, feed) into a feed source. */
export async function discoverSource(raw: string): Promise<Discovered> {
  const url = validatePublicUrl(raw);

  const channel = parseTelegram(url.toString());
  if (channel) {
    const feedUrl = telegramFeedUrl(channel);
    const feed = await loadTelegram(feedUrl);
    return { name: feed.title ?? `@${channel}`, url: `https://t.me/${channel}`, feedUrl, type: "telegram", iconUrl: feed.imageUrl, feed };
  }
  if (/^(www\.)?(t|telegram)\.me$/i.test(url.hostname)) {
    throw new Error("Only public Telegram channels can be followed (a link like https://t.me/channelname). Private channels, groups and invite links need a login.");
  }

  const naver = parseNaver(url.toString());
  if (naver) {
    const feedUrl = `https://rss.blog.naver.com/${naver.blogId}.xml`;
    const { feed } = await loadFeed(feedUrl);
    return { name: feed.title ?? naver.blogId, url: `https://blog.naver.com/${naver.blogId}`, feedUrl, type: "naver", iconUrl: feed.imageUrl, feed };
  }

  const candidates: string[] = [];
  const host = url.hostname.toLowerCase();
  if (host === "substack.com" && url.pathname.startsWith("/@")) {
    candidates.push(`https://${url.pathname.slice(2).split("/")[0]}.substack.com/feed`);
  } else if (host.endsWith(".substack.com")) {
    candidates.push(`https://${host}/feed`);
  } else if (host === "substack.com") {
    throw new Error("substack.com pages need a login. Add each publication instead, e.g. https://name.substack.com.");
  }

  if (!candidates.length) {
    const page = await fetchText(url.toString());
    if (isFeedDocument(page.body)) {
      candidates.push(page.finalUrl);
    } else {
      const meta = await inspectPage(page.body, page.finalUrl);
      candidates.push(...meta.feeds);
      const origin = new URL(page.finalUrl).origin;
      candidates.push(`${origin}/feed`, `${origin}/rss.xml`, `${origin}/feed.xml`, `${origin}/atom.xml`, `${origin}/index.xml`);
    }
  }

  for (const feedUrl of [...new Set(candidates)]) {
    try {
      validatePublicUrl(feedUrl);
      const { xml, feed } = await loadFeed(feedUrl);
      const isSubstack = /<generator>\s*(<!\[CDATA\[)?\s*Substack/i.test(xml.slice(0, 3000)) || new URL(feedUrl).hostname.endsWith(".substack.com");
      const site = feed.link && /^https?:/.test(feed.link) ? feed.link : new URL(feedUrl).origin;
      return { name: feed.title ?? new URL(site).hostname, url: site, feedUrl, type: isSubstack ? "substack" : "feed", iconUrl: feed.imageUrl, feed };
    } catch {
      // try the next candidate
    }
  }
  throw new Error("No RSS or Atom feed found at that address. For a newsletter, paste the newsletter's own site (for example name.substack.com). You can still add single articles by link.");
}

interface SourceRow {
  id: number;
  type: SourceType;
  feed_url: string | null;
  last_success_at: number | null;
}

/** Insert new entries once each; existing canonical URLs are left untouched. */
export async function storeEntries(env: Env, source: SourceRow, feed: ParsedFeed): Promise<number> {
  const now = Date.now();
  const firstSync = source.last_success_at == null;
  const stmts: D1PreparedStatement[] = [];
  for (const e of feed.entries) {
    const link = e.link ?? (e.id && /^https?:/.test(e.id) ? e.id : null);
    if (!link) continue;
    let canonical: string;
    try {
      canonical = canonicalUrl(validatePublicUrl(link).toString());
    } catch {
      continue;
    }
    const excerptText = htmlToText(e.summaryHtml).slice(0, 1200) || null;
    const sortTime = e.published ?? now;
    let status = "pending";
    let rawHtml: string | null = null;
    if (source.type === "naver") {
      if (firstSync && sortTime < now - FULLTEXT_BACKFILL_DAYS * DAY) status = "skipped";
    } else {
      rawHtml = e.contentHtml ?? e.summaryHtml;
    }
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO items (source_id, canonical_url, external_id, title, author, published_at, discovered_at, sort_time,
           image_url, excerpt, preview, raw_html, access_level, text_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        source.id, canonical, e.id, e.title.slice(0, 500), e.author, e.published, now, sortTime,
        e.imageUrl, excerptText, source.type === "telegram" ? telegramPreview(excerptText) : excerptText ? previewSentence(excerptText) : null, rawHtml,
        excerptText ? "excerpt" : "metadata", status,
      ),
    );
  }
  if (!stmts.length) return 0;
  const results = await env.DB.batch(stmts);
  const added = results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  if (firstSync) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO reading_state (item_id, is_read) SELECT id, 1 FROM items WHERE source_id = ? AND sort_time < ?`,
    ).bind(source.id, now - FIRST_SYNC_UNREAD_DAYS * DAY).run();
  }
  return added;
}

export async function checkSource(env: Env, source: SourceRow): Promise<{ added: number; error?: string }> {
  const now = Date.now();
  try {
    if (!source.feed_url) return { added: 0 };
    const feed = await loadSourceFeed(source.type, source.feed_url);
    let added = await storeEntries(env, source, feed);
    // A Telegram page shows only the latest ~20 posts. If every one was new, posts may
    // have been missed since the last check, so read one page further back.
    const oldest = source.type === "telegram" ? oldestPostNumber(feed) : null;
    if (oldest && source.last_success_at != null && added >= feed.entries.length && feed.entries.length > 0) {
      const older = await loadTelegram(`${source.feed_url}?before=${oldest}`).catch(() => null);
      if (older) added += await storeEntries(env, source, older);
    }
    await env.DB.prepare("UPDATE sources SET last_checked_at = ?, last_success_at = ?, last_error = NULL WHERE id = ?").bind(now, now, source.id).run();
    return { added };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A failed check only records the error; existing items are never touched.
    await env.DB.prepare("UPDATE sources SET last_checked_at = ?, last_error = ? WHERE id = ?").bind(now, message.slice(0, 300), source.id).run();
    return { added: 0, error: message };
  }
}

interface QueuedItem {
  id: number;
  canonical_url: string;
  excerpt: string | null;
  raw_html: string | null;
  fetch_attempts: number;
  type: SourceType;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function excerptBlocks(excerpt: string | null): Block[] {
  return (excerpt ?? "").split(/\n+/).map((t) => t.trim()).filter(Boolean).map((text) => ({ t: "p" as const, text }));
}

/** Get the best permitted text for one item, then store blocks and a brief. */
export async function processItem(env: Env, item: QueuedItem): Promise<void> {
  let blocks: Block[] = [];
  let access: "full" | "excerpt" | "metadata" = item.excerpt ? "excerpt" : "metadata";
  let extra: { title?: string; author?: string | null; image?: string | null; published?: number | null } = {};
  // Count the attempt before doing the work: if an invocation dies mid-item (CPU or
  // time limit), the item still moves towards 'failed' instead of blocking the queue.
  const attempts = item.fetch_attempts + 1;
  await env.DB.prepare("UPDATE items SET fetch_attempts = ? WHERE id = ?").bind(attempts, item.id).run();
  const exhausted = attempts >= MAX_ATTEMPTS;

  try {
    if (item.raw_html != null) {
      const truncated = isTruncatedPreview(item.raw_html);
      blocks = await extractGeneric(item.raw_html, item.canonical_url);
      if (truncated) blocks = blocks.filter((b) => b.t === "img" || !/^(read more|continue reading|계속 읽기|더 보기)$/i.test(b.text));
      const text = blocksToText(blocks);
      const paywalled = truncated || PAYWALL.test(text.slice(-1500));
      // A Telegram post is complete in the channel page, however short it is.
      if (item.type === "telegram") access = text ? "full" : "metadata";
      else access = text.length >= 1500 && !paywalled ? "full" : text ? "excerpt" : access;
    } else if (item.type === "naver") {
      const ref = parseNaver(item.canonical_url);
      if (!ref?.logNo) throw new Error("Not a Naver post URL.");
      const page = await fetchText(`https://m.blog.naver.com/PostView.naver?blogId=${ref.blogId}&logNo=${ref.logNo}`);
      blocks = await extractNaver(page.body);
      if (!blocks.length) blocks = await extractGeneric(page.body, page.finalUrl, "#viewTypeSelector");
      if (blocksToText(blocks).length > (item.excerpt?.length ?? 0)) access = "full";
      else blocks = [];
    } else if (item.type === "manual") {
      const page = await fetchText(item.canonical_url);
      const meta = await inspectPage(page.body, page.finalUrl);
      blocks = await extractGeneric(page.body, page.finalUrl, "article");
      if (blocksToText(blocks).length < 500) blocks = await extractGeneric(page.body, page.finalUrl, "main");
      if (blocksToText(blocks).length < 500) blocks = await extractGeneric(page.body, page.finalUrl);
      const text = blocksToText(blocks);
      access = text.length >= 1500 && !PAYWALL.test(text.slice(-1500)) ? "full" : text ? "excerpt" : "metadata";
      extra = { title: meta.title ?? undefined, author: meta.author, image: meta.image, published: meta.published };
      if (!item.excerpt && meta.description) item.excerpt = meta.description;
    }
  } catch (err) {
    if (!exhausted) return; // stays pending; retried on a later run
    console.warn(`item ${item.id}: giving up after ${attempts} attempts`, err);
    await env.DB.prepare("UPDATE items SET text_status = 'failed' WHERE id = ?").bind(item.id).run();
    blocks = [];
  }

  if (!blocks.length) blocks = excerptBlocks(item.excerpt);
  const text = blocksToText(blocks).slice(0, MAX_TEXT);
  const brief = buildBrief(text);
  const now = Date.now();
  const preview =
    item.type === "telegram"
      ? telegramPreview(text)
      : brief.paragraphs[0] ? previewSentence(brief.paragraphs[0]) : previewSentence(item.excerpt ?? text);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE items SET blocks = ?, permitted_text = ?, access_level = ?, content_hash = ?, preview = COALESCE(?, preview),
         excerpt = COALESCE(excerpt, ?), raw_html = NULL,
         text_status = CASE WHEN text_status = 'failed' THEN 'failed' ELSE 'done' END,
         title = CASE WHEN ? IS NOT NULL AND source_id IN (SELECT id FROM sources WHERE type = 'manual') THEN ? ELSE title END,
         author = COALESCE(author, ?), image_url = COALESCE(image_url, ?),
         published_at = COALESCE(published_at, ?), sort_time = COALESCE(published_at, ?, sort_time)
       WHERE id = ?`,
    ).bind(
      JSON.stringify(blocks), text || null, access, text ? await sha256(text) : null, preview,
      item.excerpt ?? (text.slice(0, 600) || null),
      extra.title ?? null, extra.title ?? null, extra.author ?? null, extra.image ?? null,
      extra.published ?? null, extra.published ?? null, item.id,
    ),
    env.DB.prepare(
      `INSERT INTO summaries (item_id, body, method, source_scope, generated_at, status) VALUES (?, ?, 'extractive-basic', ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET body = excluded.body, source_scope = excluded.source_scope,
         generated_at = excluded.generated_at, status = excluded.status, report_note = NULL`,
    ).bind(item.id, JSON.stringify(brief.paragraphs), access === "full" ? "full" : "excerpt", now, brief.status),
  ]);
}

const QUEUE_SELECT = `SELECT i.id, i.canonical_url, i.excerpt, i.raw_html, i.fetch_attempts, s.type
  FROM items i JOIN sources s ON s.id = i.source_id`;

export async function processQueued(env: Env, limit: number): Promise<number> {
  // Items that crashed their invocation MAX_ATTEMPTS times are retired so they can't block the queue.
  await env.DB.prepare("UPDATE items SET text_status = 'failed' WHERE text_status = 'pending' AND fetch_attempts >= ?").bind(MAX_ATTEMPTS).run();
  // Items whose text arrived in the feed need no fetch and little CPU when small, so
  // a run takes several of those on top of `limit` items that need a page fetch.
  const inline = await env.DB.prepare(
    `${QUEUE_SELECT} WHERE i.text_status = 'pending' AND i.raw_html IS NOT NULL AND LENGTH(i.raw_html) < ? ORDER BY i.sort_time DESC LIMIT ?`,
  ).bind(SMALL_INLINE_HTML, INLINE_PER_RUN).all<QueuedItem>();
  const fetched = await env.DB.prepare(
    `${QUEUE_SELECT} WHERE i.text_status = 'pending' AND (i.raw_html IS NULL OR LENGTH(i.raw_html) >= ?) ORDER BY i.sort_time DESC LIMIT ?`,
  ).bind(SMALL_INLINE_HTML, limit).all<QueuedItem>();
  const results = [...inline.results, ...fetched.results];
  for (const item of results) await processItem(env, item);
  return results.length;
}

/** Opening an item that was skipped during backfill fetches its text on demand. */
export async function ensureText(env: Env, id: number): Promise<void> {
  const item = await env.DB.prepare(`${QUEUE_SELECT} WHERE i.id = ? AND i.text_status IN ('pending', 'skipped')`).bind(id).first<QueuedItem>();
  if (item) await processItem(env, item);
}

export interface CycleResult {
  checked: number;
  added: number;
  processed: number;
  errors: { sourceId: number; error: string }[];
}

/**
 * One unit of background work: check sources that are due, then process a few
 * queued items. `force` checks every enabled source not checked in the last 10 minutes.
 */
export async function runCycle(env: Env, opts: { force?: boolean; sourceLimit?: number; itemLimit?: number } = {}): Promise<CycleResult> {
  const now = Date.now();
  const due = opts.force
    ? await env.DB.prepare(
        `SELECT id, type, feed_url, last_success_at FROM sources
         WHERE enabled = 1 AND feed_url IS NOT NULL AND (last_checked_at IS NULL OR last_checked_at < ?)
         ORDER BY last_checked_at IS NOT NULL, last_checked_at LIMIT ?`,
      ).bind(now - 10 * 60_000, opts.sourceLimit ?? 8).all<SourceRow>()
    : await env.DB.prepare(
        `SELECT id, type, feed_url, last_success_at FROM sources
         WHERE enabled = 1 AND feed_url IS NOT NULL AND (last_checked_at IS NULL OR last_checked_at < ? - check_frequency * 3600000)
         ORDER BY last_checked_at IS NOT NULL, last_checked_at LIMIT ?`,
      ).bind(now, opts.sourceLimit ?? 4).all<SourceRow>();

  const result: CycleResult = { checked: 0, added: 0, processed: 0, errors: [] };
  for (const source of due.results) {
    const r = await checkSource(env, source);
    result.checked++;
    result.added += r.added;
    if (r.error) result.errors.push({ sourceId: source.id, error: r.error });
  }
  result.processed = await processQueued(env, opts.itemLimit ?? 3);
  return result;
}

/** Add a single article by link, filed under the built-in "Saved links" source. */
export async function addArticle(env: Env, raw: string): Promise<number> {
  const url = validatePublicUrl(raw);
  const canonical = canonicalUrl(url.toString());
  const naver = parseNaver(canonical);
  let source = await env.DB.prepare("SELECT id FROM sources WHERE type = 'manual' LIMIT 1").first<{ id: number }>();
  if (!source) {
    source = await env.DB.prepare(
      "INSERT INTO sources (name, url, feed_url, type, enabled, created_at) VALUES ('Saved links', '', NULL, 'manual', 1, ?) RETURNING id",
    ).bind(Date.now()).first<{ id: number }>();
  }
  const existing = await env.DB.prepare("SELECT id FROM items WHERE canonical_url = ?").bind(canonical).first<{ id: number }>();
  if (existing) return existing.id;
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO items (source_id, canonical_url, title, discovered_at, sort_time, access_level, text_status)
     VALUES (?, ?, ?, ?, ?, 'metadata', 'pending') RETURNING id`,
  ).bind(source!.id, canonical, url.hostname, now, now).first<{ id: number }>();
  const id = row!.id;
  const item: QueuedItem = { id, canonical_url: canonical, excerpt: null, raw_html: null, fetch_attempts: 0, type: naver?.logNo ? "naver" : "manual" };
  // Naver posts added by hand use the Naver extractor but still need a title.
  if (item.type === "naver") {
    const page = await fetchText(`https://m.blog.naver.com/PostView.naver?blogId=${naver!.blogId}&logNo=${naver!.logNo}`).catch(() => null);
    if (page) {
      const meta = await inspectPage(page.body, page.finalUrl);
      await env.DB.prepare("UPDATE items SET title = ?, image_url = ?, published_at = ?, sort_time = COALESCE(?, sort_time) WHERE id = ?")
        .bind(meta.title ?? url.hostname, meta.image, meta.published, meta.published, id).run();
    }
  }
  await processItem(env, item);
  return id;
}
