import { useEffect, useRef, type ReactNode } from "react";

/** Bottom action sheet built on <dialog>, so focus trapping and Escape come for free. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-body">
        <p className="sheet-title">{title}</p>
        {children}
        <button type="button" className="sheet-btn sheet-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
