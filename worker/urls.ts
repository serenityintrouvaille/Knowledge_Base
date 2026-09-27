// URL validation and canonicalisation.

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|fromRss|trackingCode|referrerCode|navType|triedRedirect)$/i;

/**
 * Accept only public http(s) URLs. Workers cannot reach private networks, but we
 * still refuse obvious internal targets so a pasted URL can't probe anything.
 */
export function validatePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That doesn't look like a URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https links are supported.");
  if (url.username || url.password) throw new Error("Links with embedded credentials are not allowed.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    !host.includes(".") && !host.includes(":")
  ) {
    throw new Error("Private or internal addresses are not allowed.");
  }
  if (isPrivateIp(host)) throw new Error("Private or internal addresses are not allowed.");
  if (url.port && !["80", "443", ""].includes(url.port)) throw new Error("Only standard web ports are allowed.");
  return url;
}

function isPrivateIp(host: string): boolean {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (host.includes(":")) {
    return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:");
  }
  return false;
}

export interface NaverRef {
  blogId: string;
  logNo?: string;
}

/** Recognise any Naver blog URL form: desktop, mobile, PostView/PostList, or /blogId/logNo. */
export function parseNaver(raw: string): NaverRef | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "rss.blog.naver.com") {
    const id = url.pathname.replace(/^\//, "").replace(/\.xml$/, "");
    return id ? { blogId: id } : null;
  }
  if (host !== "blog.naver.com" && host !== "m.blog.naver.com") return null;
  const qBlog = url.searchParams.get("blogId");
  if (qBlog) return { blogId: qBlog, logNo: url.searchParams.get("logNo") ?? undefined };
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 1 && /^[\w-]+$/.test(parts[0]) && !parts[0].includes(".")) {
    const logNo = parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : undefined;
    return { blogId: parts[0], logNo };
  }
  return null;
}

export function canonicalUrl(raw: string): string {
  const naver = parseNaver(raw);
  if (naver?.logNo) return `https://blog.naver.com/${naver.blogId}/${naver.logNo}`;
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  let out = url.toString();
  if (url.pathname.length > 1 && out.endsWith("/") && !url.search) out = out.slice(0, -1);
  return out;
}
