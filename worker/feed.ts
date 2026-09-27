// A small, allocation-light RSS 2.0 / Atom parser. Workers have no DOMParser, and a
// full XML library costs more CPU than the free plan allows per invocation.

export interface FeedEntry {
  id: string | null;
  title: string;
  link: string | null;
  author: string | null;
  published: number | null;
  summaryHtml: string | null; // <description> / <summary>
  contentHtml: string | null; // <content:encoded> / <content>
  imageUrl: string | null;
}

export interface ParsedFeed {
  title: string | null;
  link: string | null;
  imageUrl: string | null;
  entries: FeedEntry[];
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", middot: "·" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Contents of an element's text: CDATA is taken verbatim, otherwise entities are decoded once. */
function textOf(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  const s = cdata ? cdata[1] : decodeEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
  const trimmed = s.trim();
  return trimmed || null;
}

function escapeTag(tag: string) {
  return tag.replace(/[:.]/g, (c) => "\\" + c);
}

function inner(xml: string, tag: string): string | null {
  const re = new RegExp(`<${escapeTag(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(tag)}>`, "i");
  const m = xml.match(re);
  return m ? m[1] : null;
}

function attr(xml: string, tag: string, name: string, where?: (openTag: string) => boolean): string | null {
  const re = new RegExp(`<${escapeTag(tag)}\\s[^>]*>`, "gi");
  for (const m of xml.matchAll(re)) {
    if (where && !where(m[0])) continue;
    const a = m[0].match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
    if (a) return decodeEntities(a[2] ?? a[3] ?? "");
  }
  return null;
}

function parseDate(raw: string | null): number | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  return Number.isFinite(t) ? t : null;
}

function firstImage(html: string | null): string | null {
  if (!html) return null;
  const m = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]) : null;
}

/** Inner XML of every <tag> element, so per-item lookups stay local to that item. */
function blocksOf(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  return [...xml.matchAll(re)].map((m) => m[1]);
}

export function isFeedDocument(body: string): boolean {
  const head = body.slice(0, 2000);
  return /<rss[\s>]/i.test(head) || /<feed[\s>]/i.test(head) || /<rdf:RDF[\s>]/i.test(head);
}

export function parseFeed(xml: string): ParsedFeed {
  const isAtom = /<feed[\s>]/i.test(xml.slice(0, 2000)) && !/<rss[\s>]/i.test(xml.slice(0, 2000));
  if (isAtom) return parseAtom(xml);

  const channelHead = xml.split(/<item[\s>]/i)[0];
  const entries = blocksOf(xml, "item").map((it): FeedEntry => {
    const contentHtml = textOf(inner(it, "content:encoded"));
    const summaryHtml = textOf(inner(it, "description"));
    const enclosureImg = attr(it, "enclosure", "url", (t) => /type\s*=\s*["']image\//i.test(t));
    const mediaImg = attr(it, "media:content", "url") ?? attr(it, "media:thumbnail", "url");
    return {
      id: textOf(inner(it, "guid")),
      title: textOf(inner(it, "title")) ?? "(untitled)",
      link: textOf(inner(it, "link")),
      author: textOf(inner(it, "dc:creator")) ?? textOf(inner(it, "author")),
      published: parseDate(textOf(inner(it, "pubDate")) ?? textOf(inner(it, "dc:date"))),
      summaryHtml,
      contentHtml,
      imageUrl: enclosureImg ?? mediaImg ?? firstImage(contentHtml) ?? firstImage(summaryHtml),
    };
  });
  const imageBlock = inner(channelHead, "image");
  return {
    title: textOf(inner(channelHead, "title")),
    link: textOf(inner(channelHead, "link")),
    imageUrl: imageBlock ? textOf(inner(imageBlock, "url")) : null,
    entries,
  };
}

function parseAtom(xml: string): ParsedFeed {
  const head = xml.split(/<entry[\s>]/i)[0];
  const altLink = (s: string) =>
    attr(s, "link", "href", (t) => !/rel\s*=/i.test(t) || /rel\s*=\s*["']alternate["']/i.test(t));
  const entries = blocksOf(xml, "entry").map((e): FeedEntry => {
    const contentHtml = textOf(inner(e, "content"));
    const summaryHtml = textOf(inner(e, "summary"));
    const authorBlock = inner(e, "author");
    return {
      id: textOf(inner(e, "id")),
      title: textOf(inner(e, "title")) ?? "(untitled)",
      link: altLink(e),
      author: authorBlock ? textOf(inner(authorBlock, "name")) : null,
      published: parseDate(textOf(inner(e, "published")) ?? textOf(inner(e, "updated"))),
      summaryHtml,
      contentHtml,
      imageUrl: attr(e, "media:thumbnail", "url") ?? firstImage(contentHtml) ?? firstImage(summaryHtml),
    };
  });
  return {
    title: textOf(inner(head, "title")),
    link: altLink(head),
    imageUrl: textOf(inner(head, "icon")) ?? textOf(inner(head, "logo")),
    entries,
  };
}

/** Plain text from a small HTML fragment (feed descriptions). */
export function htmlToText(html: string | null): string {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[​ ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
