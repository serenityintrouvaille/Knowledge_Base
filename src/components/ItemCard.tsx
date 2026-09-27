import { Link } from "react-router";
import type { ItemCard as Item } from "../../shared/types";
import { ACCESS_LABEL, cardTime } from "../format";
import { IconBookmark, IconMore } from "./Icons";

interface Props {
  item: Item;
  match?: string | null;
  query?: string;
  onToggleSave?: (item: Item) => void;
  onMore?: (item: Item) => void;
  showDate?: boolean;
}

export function highlightMatch(text: string, q?: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function ItemCard({ item, match, query, onToggleSave, onMore, showDate }: Props) {
  const unread = !item.isRead;
  const time = showDate ? new Date(item.sortTime).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : cardTime(item.sortTime);
  return (
    <article className={`card${unread ? " is-unread" : ""}`}>
      <Link to={`/item/${item.id}`} className="card-link">
        <div className="card-meta">
          {unread && <span className="unread-dot" aria-hidden="true" />}
          {unread && <span className="sr-only">Unread. </span>}
          <span className="card-source">{item.sourceName}</span>
          <span aria-hidden="true"> · </span>
          <time dateTime={new Date(item.sortTime).toISOString()}>
            {time}
            {item.publishedAt == null && <span className="muted-note"> (found)</span>}
          </time>
        </div>
        <h3 className="card-title">{highlightMatch(item.title, query)}</h3>
        {(match ?? item.preview) && <p className="card-preview">{highlightMatch(match ?? item.preview ?? "", query)}</p>}
        <div className="card-foot">
          <span className={`chip chip-${item.accessLevel}`}>{ACCESS_LABEL[item.accessLevel]}</span>
          {item.isSaved && <span className="chip chip-saved">Saved</span>}
        </div>
      </Link>
      {(onToggleSave || onMore) && (
        <div className="card-actions">
          {onToggleSave && (
            <button
              type="button"
              className="icon-btn"
              aria-pressed={item.isSaved}
              aria-label={item.isSaved ? `Remove "${item.title}" from saved` : `Save "${item.title}"`}
              onClick={() => onToggleSave(item)}
            >
              <IconBookmark filled={item.isSaved} />
            </button>
          )}
          {onMore && (
            <button type="button" className="icon-btn" aria-label={`More actions for "${item.title}"`} onClick={() => onMore(item)}>
              <IconMore />
            </button>
          )}
        </div>
      )}
    </article>
  );
}
