// Turn HTML (feed content or a fetched page) into plain-text blocks using the
// runtime's streaming HTMLRewriter. Nothing here ever produces HTML for display.

import type { Block } from "../shared/types";
import { decodeEntities } from "./feed";

export const USER_AGENT = "Mozilla/5.0 (compatible; DailyArchive/1.0; personal feed reader)";
const MAX_BYTES = 3_000_000;

export async function fetchText(url: string, init: { accept?: string; timeoutMs?: number } = {}): Promise<{ body: string; finalUrl: string; contentType: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: init.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error("Page is too large to import.");
  const body = await res.text();
  if (body.length > MAX_BYTES) throw new Error("Page is too large to import.");
  return { body, finalUrl: res.url || url, contentType: res.headers.get("content-type") ?? "" };
}

async function run(html: string, rewriter: HTMLRewriter): Promise<void> {
  await rewriter.transform(new Response(html)).arrayBuffer();
}

function clean(text: string): string {
  return decodeEntities(text)
    .replace(/[​﻿]/g, "")
    .replace(/ /g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function imageSrc(el: Element): string | null {
  const src = el.getAttribute("data-lazy-src") ?? el.getAttribute("data-src") ?? el.getAttribute("src");
  if (!src || src.startsWith("data:")) return null;
  const w = Number(el.getAttribute("width") ?? 0);
  if (w > 0 && w < 40) return null; // tracking pixels, icons
  return decodeEntities(src);
}

function absolute(src: string, base?: string): string | null {
  try {
    const u = new URL(src, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const SKIP = "script, style, noscript, svg, nav, aside, footer, form, button, iframe, template";
const BLOCKS = ["p", "h1", "h2", "h3", "h4", "li", "pre", "figcaption"];

/** Generic article extraction. `scope` restricts collection to one container, e.g. "article". */
export async function extractGeneric(html: string, base?: string, scope = ""): Promise<Block[]> {
  type Open = { t: Block["t"]; text: string };
  const out: (Open | Block)[] = [];
  const stack: Open[] = [];
  let quote = 0;
  let skip = 0;
  const pre = scope ? scope + " " : "";

  const rw = new HTMLRewriter()
    .on(SKIP, {
      element(el) {
        skip++;
        el.onEndTag(() => void skip--);
      },
    })
    .on(`${pre}blockquote`, {
      element(el) {
        quote++;
        el.onEndTag(() => void quote--);
      },
    })
    .on(BLOCKS.map((b) => pre + b).join(", "), {
      element(el) {
        if (skip > 0) return;
        const tag = el.tagName.toLowerCase();
        // <p> cannot nest; an unclosed one ends where the next begins.
        if (tag === "p" && stack.at(-1)?.t !== "li" && stack.length) stack.pop();
        const t: Block["t"] = /^h\d$/.test(tag) ? "h" : tag === "li" ? "li" : tag === "pre" ? "pre" : quote > 0 ? "quote" : "p";
        const open: Open = { t, text: "" };
        stack.push(open);
        out.push(open);
        el.onEndTag(() => {
          const i = stack.lastIndexOf(open);
          if (i >= 0) stack.splice(i, 1);
        });
      },
    })
    .on(`${pre}br`, {
      element() {
        const top = stack.at(-1);
        if (top) top.text += "\n";
      },
    })
    .on(`${pre}img`, {
      element(el) {
        if (skip > 0) return;
        const src = imageSrc(el);
        const abs = src && absolute(src, base);
        if (abs) out.push({ t: "img", src: abs, alt: el.getAttribute("alt") ?? undefined });
      },
    })
    .onDocument({
      text(chunk) {
        const top = stack.at(-1);
        if (top && skip === 0) top.text += chunk.text;
      },
    });
  await run(html, rw);
  return finalize(out);
}

function finalize(raw: (Block | { t: Block["t"]; text: string })[]): Block[] {
  const blocks: Block[] = [];
  for (const b of raw) {
    if (b.t === "img") {
      blocks.push(b as Block);
      continue;
    }
    const text = b.t === "pre" ? decodeEntities((b as { text: string }).text).trim() : clean((b as { text: string }).text);
    if (!text) continue;
    // li wrapping a <p> ends up empty and the paragraph carries the text; drop exact repeats.
    const prev = blocks.at(-1);
    if (prev && prev.t !== "img" && prev.text === text) continue;
    blocks.push({ t: b.t as Exclude<Block["t"], "img">, text });
  }
  return blocks;
}

/**
 * Naver's SmartEditor renders every line as its own <p class="se-text-paragraph">,
 * with empty lines between paragraphs. Rebuild real paragraphs per component.
 */
export async function extractNaver(html: string): Promise<Block[]> {
  type Comp = { kind: "p" | "quote" | "h" | "other"; lines: string[] };
  const comps: (Comp | Block)[] = [];
  let comp: Comp | null = null;

  const rw = new HTMLRewriter()
    .on(".se-main-container .se-component", {
      element(el) {
        const cls = el.getAttribute("class") ?? "";
        const kind: Comp["kind"] = /\bse-text\b/.test(cls) ? "p" : /\bse-quotation\b/.test(cls) ? "quote" : /\bse-sectionTitle\b/.test(cls) ? "h" : "other";
        comp = { kind, lines: [] };
        comps.push(comp);
      },
    })
    .on(".se-main-container p.se-text-paragraph", {
      element() {
        comp?.lines.push("");
      },
    })
    .on(".se-main-container p.se-text-paragraph br", {
      element() {
        if (comp && comp.lines.length) comp.lines[comp.lines.length - 1] += "\n";
      },
    })
    .on(".se-main-container p.se-text-paragraph", {
      text(chunk) {
        if (comp && comp.lines.length) comp.lines[comp.lines.length - 1] += chunk.text;
      },
    })
    .on(".se-main-container img.se-image-resource", {
      element(el) {
        const src = imageSrc(el);
        if (src) comps.push({ t: "img", src });
      },
    });
  await run(html, rw);

  const blocks: Block[] = [];
  for (const c of comps) {
    if ("t" in c) {
      blocks.push(c);
      continue;
    }
    if (c.kind === "other") continue;
    let para: string[] = [];
    const flush = () => {
      const text = clean(para.join("\n"));
      if (text) blocks.push({ t: c.kind as "p" | "quote" | "h", text });
      para = [];
    };
    for (const line of c.lines) {
      if (!clean(line)) flush();
      else para.push(line.replace(/\n+$/, ""));
    }
    flush();
  }
  return blocks;
}

export interface PageMeta {
  title: string | null;
  description: string | null;
  image: string | null;
  author: string | null;
  published: number | null;
  siteName: string | null;
  feeds: string[];
  canonical: string | null;
}

export async function inspectPage(html: string, base: string): Promise<PageMeta> {
  const meta: Record<string, string> = {};
  const feeds: string[] = [];
  let title = "";
  let inTitle = false;
  let canonical: string | null = null;
  const rw = new HTMLRewriter()
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("property") ?? el.getAttribute("name") ?? "").toLowerCase();
        const content = el.getAttribute("content");
        if (key && content && !(key in meta)) meta[key] = decodeEntities(content);
      },
    })
    .on("link", {
      element(el) {
        const rel = (el.getAttribute("rel") ?? "").toLowerCase();
        const type = (el.getAttribute("type") ?? "").toLowerCase();
        const href = el.getAttribute("href");
        if (!href) return;
        if (rel.includes("alternate") && /(rss|atom)\+xml/.test(type)) {
          const abs = absolute(decodeEntities(href), base);
          if (abs) feeds.push(abs);
        }
        if (rel === "canonical") canonical = absolute(decodeEntities(href), base);
      },
    })
    .on("head title", {
      element(el) {
        inTitle = true;
        el.onEndTag(() => void (inTitle = false));
      },
      text(chunk) {
        if (inTitle) title += chunk.text;
      },
    });
  await run(html, rw);
  const published = Date.parse(meta["article:published_time"] ?? meta["og:article:published_time"] ?? meta["date"] ?? "");
  const image = meta["og:image"] ?? meta["twitter:image"];
  return {
    title: meta["og:title"] ?? (clean(title) || null),
    description: meta["og:description"] ?? meta["description"] ?? null,
    image: image ? absolute(image, base) : null,
    author: meta["author"] ?? meta["article:author"] ?? null,
    published: Number.isFinite(published) ? published : null,
    siteName: meta["og:site_name"] ?? null,
    feeds,
    canonical,
  };
}

export function blocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => (b.t === "img" ? "" : b.text))
    .filter(Boolean)
    .join("\n\n");
}
