// Basic brief: selects the most representative sentences from the author's own text
// and keeps them in their original order. It is extractive, not an AI summary, and
// the UI labels it that way.

const MIN_CHARS = 900; // below this there is not enough material for an honest brief
const MIN_UNITS = 6;

const EN_STOP = new Set(
  "a an and are as at be been but by can could did do does for from had has have he her his i if in into is it its just more most my no not of on or our she so some than that the their them then there these they this those to too up us was we were what when which who will with would you your also about after all any because before being both each few how here how many much only other over same should such through under very while".split(" "),
);
const KO_STOP = new Set("그리고 그러나 하지만 그래서 또한 이런 저런 그런 이것 그것 저것 있다 없다 한다 했다 된다 되었다 것이다 때문 정도 경우 대한 위해 통해 가장 많이 정말 너무 이번 오늘 우리 나는 내가 이제".split(" "));
// Common Korean particles/endings, longest first, so "시장에서" and "시장은" both count as "시장".
const KO_SUFFIX = /(으로부터|에서부터|에게서|으로서|으로써|이라는|이라고|에서는|에서의|까지는|부터는|하였다|했었다|합니다|입니다|이었다|였다|에서|에게|으로|로서|로써|이다|했다|한다|하는|하고|해서|이며|이고|이나|까지|부터|처럼|보다|라는|라고|은|는|이|가|을|를|에|의|와|과|도|만|로|며|고)$/;

export interface BriefResult {
  paragraphs: string[];
  status: "ready" | "unavailable";
}

export function isHangul(text: string): boolean {
  const sample = text.slice(0, 2000);
  const ko = (sample.match(/[가-힣]/g) ?? []).length;
  const letters = (sample.match(/\p{L}/gu) ?? []).length;
  return letters > 0 && ko / letters > 0.3;
}

export function readingMinutes(text: string): number | null {
  if (text.length < 400) return null;
  const minutes = isHangul(text) ? text.replace(/\s/g, "").length / 500 : text.split(/\s+/).length / 230;
  return Math.max(1, Math.round(minutes));
}

/** Split into sentence-like units. Korean blog lines often have no punctuation, so each line counts. */
export function splitUnits(text: string): string[] {
  const units: string[] = [];
  for (const line of text.split(/\n+/)) {
    const l = line.trim();
    if (!l) continue;
    const parts = l.match(/[^.!?。？！]+(?:[.!?。？！]+["'”’)\]]*|$)/g) ?? [l];
    let carry = "";
    for (const p of parts) {
      const s = (carry + p).trim();
      // Keep decimals, abbreviations and short fragments attached to the next piece.
      if (s.length < 20 || /\d\.$/.test(s)) {
        carry = s + (/\d\.$/.test(s) ? "" : " ");
        continue;
      }
      carry = "";
      units.push(s);
    }
    if (carry.trim()) units.push(carry.trim());
  }
  return units;
}

function tokens(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let w = raw;
    if (/[가-힣]/.test(w) && w.length > 2) w = w.replace(KO_SUFFIX, "") || w;
    if (w.length < 2 || EN_STOP.has(w) || KO_STOP.has(w) || /^\d+$/.test(w)) continue;
    out.push(w);
  }
  return out;
}

function usable(u: string): boolean {
  if (u.length < 25 || u.length > 420) return false;
  if (/^#\S+(\s+#\S+)*$/.test(u)) return false; // hashtag lines
  if (/https?:\/\//.test(u) && u.length < 120) return false;
  if (/^(출처|source|photo|image|사진)\s*[:：]/i.test(u)) return false;
  if (/(구독|subscribe|공감|댓글|좋아요|share this|sign up|unsubscribe)/i.test(u) && u.length < 80) return false;
  return true;
}

export function buildBrief(text: string): BriefResult {
  const all = splitUnits(text);
  const units = all.map((u, i) => ({ u, i })).filter(({ u }) => usable(u));
  const usableChars = units.reduce((n, x) => n + x.u.length, 0);
  if (usableChars < MIN_CHARS || units.length < MIN_UNITS) return { paragraphs: [], status: "unavailable" };

  const tf = new Map<string, number>();
  const toks = units.map(({ u }) => tokens(u));
  for (const ts of toks) for (const t of new Set(ts)) tf.set(t, (tf.get(t) ?? 0) + 1);

  const total = all.length;
  const scored = units.map(({ u, i }, k) => {
    const uniq = [...new Set(toks[k])];
    if (!uniq.length) return { u, i, score: 0, set: new Set<string>() };
    let score = uniq.reduce((n, t) => n + Math.log1p((tf.get(t) ?? 1) - 1), 0) / Math.sqrt(uniq.length + 4);
    if (i < Math.max(3, total * 0.15)) score *= 1.25; // openings usually state the point
    if (/\d/.test(u)) score *= 1.1; // keep numbers and dates
    return { u, i, score, set: new Set(uniq) };
  });

  const target = Math.min(9, Math.max(5, Math.round(units.length / 8)));
  const third = (i: number) => Math.min(2, Math.floor((i / total) * 3));
  const picked: typeof scored = [];
  const isDup = (cand: (typeof scored)[number]) =>
    picked.some((p) => {
      let common = 0;
      for (const t of cand.set) if (p.set.has(t)) common++;
      return common / Math.max(1, Math.min(cand.set.size, p.set.size)) > 0.7;
    });
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  // Cover the opening, body and close first, so the brief follows the whole piece
  // rather than only its first screen; then fill by overall score.
  for (let t = 0; t < 3; t++) {
    const best = ranked.filter((c) => third(c.i) === t && c.score > 0).slice(0, 2);
    for (const c of best) if (!isDup(c)) picked.push(c);
  }
  for (const cand of ranked) {
    if (picked.length >= target) break;
    if (!picked.includes(cand) && !isDup(cand)) picked.push(cand);
  }
  picked.sort((a, b) => a.i - b.i);

  // Group by where the sentences sit in the piece: opening, body, close.
  const thirds: string[][] = [[], [], []];
  for (const p of picked) thirds[third(p.i)].push(p.u);
  let paragraphs = thirds.filter((t) => t.length).map((t) => t.join(" "));
  if (paragraphs.length === 1 && picked.length >= 2) {
    const half = Math.ceil(picked.length / 2);
    paragraphs = [picked.slice(0, half), picked.slice(half)].map((g) => g.map((p) => p.u).join(" "));
  }
  return { paragraphs, status: "ready" };
}

/** One-sentence preview for inbox cards. */
export function previewSentence(text: string): string | null {
  for (const u of splitUnits(text)) {
    if (usable(u)) return u.length > 180 ? u.slice(0, 177).trimEnd() + "…" : u;
  }
  const t = text.trim();
  return t ? (t.length > 180 ? t.slice(0, 177).trimEnd() + "…" : t) : null;
}
