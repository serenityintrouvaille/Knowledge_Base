import { describe, expect, it } from "vitest";
import { parseFeed, htmlToText, isFeedDocument } from "../worker/feed";
import { canonicalUrl, parseNaver, validatePublicUrl } from "../worker/urls";
import { buildBrief, previewSentence, readingMinutes, splitUnits } from "../worker/brief";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title><![CDATA[메르의 블로그]]></title>
  <link>https://blog.naver.com/ranto28</link>
  <image><url>https://example.com/icon.png</url><title>x</title></image>
  <item>
    <author>ranto28</author>
    <title><![CDATA[오픈AI &amp; 허깅페이스]]></title>
    <link><![CDATA[https://blog.naver.com/ranto28/224423584111?fromRss=true&trackingCode=rss]]></link>
    <guid>https://blog.naver.com/ranto28/224423584111</guid>
    <description><![CDATA[첫 문장입니다. <b>둘째</b> 문장.]]></description>
    <pubDate>Sun, 27 Sep 2026 19:58:58 +0900</pubDate>
  </item>
  <item>
    <title>Tom &amp; Jerry</title>
    <link>https://pub.substack.com/p/tom?utm_source=rss</link>
    <dc:creator>Jane</dc:creator>
    <description>&lt;p&gt;Short&lt;/p&gt;</description>
    <content:encoded><![CDATA[<p>Hello <img src="https://img.test/a.png"></p>]]></content:encoded>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<title>Atom Blog</title><link rel="self" href="https://a.test/feed.xml"/><link href="https://a.test/"/>
<entry><id>tag:a,1</id><title type="html">A &lt;em&gt;post&lt;/em&gt;</title>
<link rel="alternate" href="https://a.test/p/1"/><published>2026-09-01T10:00:00Z</published>
<author><name>Ann</name></author><summary>Sum</summary></entry></feed>`;

describe("parseFeed", () => {
  it("reads RSS channel and items, decoding CDATA and entities", () => {
    const f = parseFeed(RSS);
    expect(f.title).toBe("메르의 블로그");
    expect(f.imageUrl).toBe("https://example.com/icon.png");
    expect(f.entries).toHaveLength(2);
    const [a, b] = f.entries;
    expect(a.title).toBe("오픈AI &amp; 허깅페이스"); // CDATA is literal
    expect(a.id).toBe("https://blog.naver.com/ranto28/224423584111");
    expect(a.published).toBe(Date.parse("2026-09-27T10:58:58Z"));
    expect(htmlToText(a.summaryHtml)).toBe("첫 문장입니다. 둘째 문장.");
    expect(b.title).toBe("Tom & Jerry");
    expect(b.author).toBe("Jane");
    expect(b.summaryHtml).toBe("<p>Short</p>");
    expect(b.imageUrl).toBe("https://img.test/a.png");
    expect(b.published).toBeNull();
  });

  it("reads Atom entries and alternate links", () => {
    const f = parseFeed(ATOM);
    expect(f.title).toBe("Atom Blog");
    expect(f.link).toBe("https://a.test/");
    expect(f.entries[0]).toMatchObject({ title: "A <em>post</em>", link: "https://a.test/p/1", author: "Ann" });
    expect(f.entries[0].published).toBe(Date.parse("2026-09-01T10:00:00Z"));
  });

  it("detects feed documents", () => {
    expect(isFeedDocument(RSS)).toBe(true);
    expect(isFeedDocument(ATOM)).toBe(true);
    expect(isFeedDocument("<!doctype html><html>")).toBe(false);
  });
});

describe("urls", () => {
  it("parses every Naver URL form", () => {
    expect(parseNaver("https://blog.naver.com/PostList.naver?blogId=ranto28")).toEqual({ blogId: "ranto28", logNo: undefined });
    expect(parseNaver("https://m.blog.naver.com/PostView.naver?blogId=cahier&logNo=224399969906&navType=by")).toEqual({ blogId: "cahier", logNo: "224399969906" });
    expect(parseNaver("https://m.blog.naver.com/bambooinvesting/224422597390?referrerCode=1")).toEqual({ blogId: "bambooinvesting", logNo: "224422597390" });
    expect(parseNaver("https://rss.blog.naver.com/hodolry.xml")).toEqual({ blogId: "hodolry" });
    expect(parseNaver("https://example.com/a")).toBeNull();
  });

  it("canonicalises Naver posts and strips tracking params", () => {
    expect(canonicalUrl("https://m.blog.naver.com/PostView.naver?blogId=cahier&logNo=224399969906&navType=by")).toBe("https://blog.naver.com/cahier/224399969906");
    expect(canonicalUrl("https://blog.naver.com/ranto28/224423584111?fromRss=true&trackingCode=rss")).toBe("https://blog.naver.com/ranto28/224423584111");
    expect(canonicalUrl("https://Pub.Substack.com/p/tom/?utm_source=rss#x")).toBe("https://pub.substack.com/p/tom");
    expect(canonicalUrl("https://a.test/p?id=2&utm_medium=x")).toBe("https://a.test/p?id=2");
  });

  it("rejects private and non-web targets", () => {
    for (const bad of ["http://localhost/x", "http://127.0.0.1", "http://10.0.0.8/", "http://192.168.1.1", "http://169.254.169.254/latest", "http://[::1]/", "file:///etc/passwd", "http://intranet/", "https://a.test:8443/", "https://u:p@a.test/"]) {
      expect(() => validatePublicUrl(bad), bad).toThrow();
    }
    expect(validatePublicUrl("https://blog.naver.com/ranto28").hostname).toBe("blog.naver.com");
  });
});

describe("brief", () => {
  const topics = ["메모리 반도체", "HBM 공급", "AI 추론 수요", "하이닉스 실적", "금리 인하", "달러 약세", "엔비디아 마진", "클라우드 임대", "주주 환원", "데이터센터 전력"];
  const verbs = ["예상보다 빠르게 늘어나고 있다고 판단한다", "시장 가격에 아직 반영되지 않았다고 본다", "다음 분기 실적에 영향을 줄 가능성이 높다", "투자자들이 과소평가하고 있는 변수로 보인다"];
  const ko = Array.from({ length: 36 }, (_, i) => `${2020 + (i % 7)}년 기준으로 ${topics[i % topics.length]}의 흐름은 ${verbs[i % verbs.length]}`).join("\n");

  it("returns 2–3 paragraphs of original sentences in order", () => {
    const b = buildBrief(ko);
    expect(b.status).toBe("ready");
    expect(b.paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(b.paragraphs.length).toBeLessThanOrEqual(3);
    for (const p of b.paragraphs) for (const s of p.split(/(?<=다|요)\s/)) expect(ko).toContain(s.trim());
  });

  it("refuses to brief short excerpts", () => {
    expect(buildBrief("첫 문장입니다. 둘째 문장입니다.").status).toBe("unavailable");
  });

  it("keeps decimals inside sentences", () => {
    expect(splitUnits("Revenue grew 3.5 percent in the quarter. Margins held steady at 41 percent overall.")).toEqual([
      "Revenue grew 3.5 percent in the quarter.",
      "Margins held steady at 41 percent overall.",
    ]);
  });

  it("previews skip hashtag lines", () => {
    expect(previewSentence("#엔비디아 #금리\n이번 글은 다소 긴 분량이 될 것임을 미리 경고한다.")).toBe("이번 글은 다소 긴 분량이 될 것임을 미리 경고한다.");
  });

  it("estimates reading time for Korean and English", () => {
    expect(readingMinutes("가".repeat(2500))).toBe(5);
    expect(readingMinutes("word ".repeat(460))).toBe(2);
    expect(readingMinutes("short")).toBeNull();
  });
});
