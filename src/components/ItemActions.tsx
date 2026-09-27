import type { ItemCard } from "../../shared/types";
import { api } from "../api";
import { Sheet } from "./Sheet";

/** Shared "⋯" sheet for list cards: read/unread, save, hide. */
export function ItemActions({ item, onClose, onChange }: { item: ItemCard | null; onClose: () => void; onChange: (item: ItemCard) => void }) {
  const run = async (patch: Partial<Pick<ItemCard, "isRead" | "isSaved" | "isHidden">>) => {
    if (!item) return;
    onChange({ ...item, ...patch });
    onClose();
    await api.setState(item.id, patch);
  };
  return (
    <Sheet open={!!item} onClose={onClose} title={item?.title ?? ""}>
      {item && (
        <>
          <button type="button" className="sheet-btn" onClick={() => run({ isRead: !item.isRead })}>
            {item.isRead ? "Mark as unread" : "Mark as read"}
          </button>
          <button type="button" className="sheet-btn" onClick={() => run({ isSaved: !item.isSaved })}>
            {item.isSaved ? "Remove from saved" : "Save"}
          </button>
          <a className="sheet-btn" href={item.url} target="_blank" rel="noopener noreferrer" onClick={onClose}>
            Open original
          </a>
          <button type="button" className="sheet-btn" onClick={() => run({ isHidden: !item.isHidden })}>
            {item.isHidden ? "Unhide" : "Hide from inbox"}
          </button>
        </>
      )}
    </Sheet>
  );
}
