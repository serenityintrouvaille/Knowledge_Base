// Public Telegram channels via their web preview (t.me/s/<channel>), which lists the
// latest ~20 posts without a login. Private channels and groups are not reachable.

import { decodeEntities, htmlToText, type FeedEntry, type ParsedFeed } from "./feed";

const NAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

/** Channel name from t.me/<name>, t.me/s/<name>, t.me/<name>/<post> or telegram.me links. */
export function parseTelegram(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "t.me" && host !== "telegram.me") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const name = parts[0] === "s" ? parts[1] : parts[0];
  if (!name || name === "c" || name === "joinchat" || name.startsWith("+")) return null;
  return NAME.test(name) ? name : null;
}

export const telegramFeedUrl = (channel: string) => `https://t.me/s/${channel}`;

function firstLineTitle(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!line) return "(photo)";
  if (line.length <= 90) return line;
  const cut = line.slice(0, 88);
  const space = cut.lastIndexOf(" ");
  return (space > 50 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

/** Split Telegram's <br>-separated text into paragraphs the block extractor understands. */
function textToParagraphs(html: string): string {
  return html
    .split(/(?:<br\s*\/?>\s*){2,}/i)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p}</p>`)
    .join("");
}

export function parseTelegramPage(html: string, channel: string): ParsedFeed {
  const meta = (prop: string) => {
    const m = html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`));
    return m ? decodeEntities(m[1]) : null;
  };
  const entries: FeedEntry[] = [];
  const chunks = html.split(/<div class="tgme_widget_message_wrap[^"]*"/).slice(1);
  for (const chunk of chunks) {
    const post = chunk.match(/data-post="([^"]+)"/)?.[1];
    if (!post) continue;
    // Drop the quoted message a reply points at, so only this post's own text is read.
    const body = chunk.replace(/<a class="tgme_widget_message_reply[\s\S]*?<\/a>/, "");
    const textHtml = body.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const photos = [...body.matchAll(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/g)].map((m) => m[1]);
    const forwarded = body.match(/tgme_widget_message_forwarded_from_name"[^>]*>(?:<span[^>]*>)?([^<]+)/)?.[1];
    const datetime = body.match(/<time datetime="([^"]+)"/)?.[1];
    const text = htmlToText(textHtml.replace(/<br\s*\/?>/gi, "\n"));
    if (!text && !photos.length) continue; // stickers, polls, service messages

    const contentHtml = [
      forwarded ? `<p>Forwarded from ${forwarded}</p>` : "",
      textToParagraphs(textHtml),
      ...photos.map((src) => `<img src="${src}" alt="">`),
    ].join("");
    const published = datetime ? Date.parse(datetime) : NaN;
    entries.push({
      id: `https://t.me/${post}`,
      title: firstLineTitle(text),
      link: `https://t.me/${post}`,
      author: forwarded ? `Forwarded from ${decodeEntities(forwarded).trim()}` : null,
      published: Number.isFinite(published) ? published : null,
      summaryHtml: textToParagraphs(textHtml) || null,
      contentHtml,
      imageUrl: photos[0] ?? null,
    });
  }
  if (!entries.length && !html.includes("tgme_channel_info")) {
    throw new Error(`@${channel} isn't a public channel with web preview, so it can't be followed without a Telegram login.`);
  }
  return { title: meta("og:title") ?? `@${channel}`, link: `https://t.me/${channel}`, imageUrl: meta("og:image"), entries };
}

/** Oldest post number on the page, used to fetch the page before it. */
export function oldestPostNumber(feed: ParsedFeed): number | null {
  const nums = feed.entries.map((e) => Number(e.link?.split("/").pop())).filter(Number.isFinite);
  return nums.length ? Math.min(...nums) : null;
}
