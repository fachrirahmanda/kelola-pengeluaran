import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from './Dialog';

// A side panel that is part of the page layout, like the sidebar. On wide screens (1024px and up) it is always
// shown in a column at the right edge of the app, outside the page container, so it gets no page spacing and
// stays sticky while the page scrolls. Nothing closes it. Below that width the same content is a popup in the
// middle of the screen, a Dialog that the page opens from a button.

const PHONE_QUERY = '(max-width: 1023px)';

/** The empty column at the right of the app (Layout), where a side panel is drawn. Null until Layout has mounted. */
export const SideSlotContext = createContext<HTMLElement | null>(null);

/** True below 1024px, where the panel is a popup rather than a column. */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhone(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return phone;
}

export function SidePanel({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const phone = usePhone();
  const slot = useContext(SideSlotContext);

  if (phone) {
    return (
      <Dialog open={open} onClose={onClose} title={title} className="ds-side-panel">
        <div className="side-panel-scope">{children}</div>
      </Dialog>
    );
  }
  if (!slot) return null;

  return createPortal(
    <aside className="side-panel" aria-label={title}>
      {/* The same head as the sidebar on the left (Basis ds-sidebar-head): same height, padding and type. */}
      <div className="ds-sidebar-head">
        <h2 className="side-panel-title">{title}</h2>
      </div>
      <div className="side-panel-body side-panel-scope">{children}</div>
    </aside>,
    slot,
  );
}
