// Shapes shared by the Worker API and the React app.

export type AccessLevel = "full" | "excerpt" | "metadata";
export type SourceType = "naver" | "substack" | "feed" | "manual";

/** Article body stored as plain-text blocks, so imported HTML is never rendered. */
export type Block =
  | { t: "p" | "h" | "quote" | "li" | "pre"; text: string }
  | { t: "img"; src: string; alt?: string };

export interface Brief {
  paragraphs: string[];
  method: "extractive-basic";
  scope: "full" | "excerpt";
  status: "ready" | "unavailable" | "reported";
  generatedAt: number;
}

export interface ItemCard {
  id: number;
  sourceId: number;
  sourceName: string;
  title: string;
  url: string;
  author: string | null;
  publishedAt: number | null;
  discoveredAt: number;
  sortTime: number;
  contentType: string;
  imageUrl: string | null;
  preview: string | null;
  accessLevel: AccessLevel;
  isRead: boolean;
  isSaved: boolean;
  isHidden: boolean;
  lastOpenedAt: number | null;
}

export interface ItemDetail extends ItemCard {
  blocks: Block[];
  excerpt: string | null;
  brief: Brief | null;
  readingMinutes: number | null;
  readingPosition: number | null;
  textStatus: string;
}

export interface Source {
  id: number;
  name: string;
  url: string;
  feedUrl: string | null;
  type: SourceType;
  iconUrl: string | null;
  category: string | null;
  enabled: boolean;
  checkFrequency: number;
  lastCheckedAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  itemCount: number;
  savedCount: number;
}

export interface Status {
  lastRefreshAt: number | null;
  unread: number;
  pending: number;
  total: number;
}
