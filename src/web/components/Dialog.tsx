import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { leave, resetMotion } from '../motion';

// Dialog from Silpasala (components/ui.tsx): a native <dialog> with a blurred scrim in the top layer
// and an exit animation before it closes. Escape, the × button and a click outside all ask first.

export function Dialog({ open, onClose, title, size = 'md', children, footer, className, bodyClassName, actions, canClose }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Extra buttons in the header, before the close button. */
  actions?: ReactNode;
  /** Asked before closing from inside (×, Escape, backdrop); false keeps the dialog open (e.g. unsaved text). */
  canClose?: () => boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // The dim, blurred layer behind the dialog. Safari doesn't keep a blur on a dialog's own
  // ::backdrop (it shows, then drops it), so the blur is a plain element in the top layer instead,
  // shown just before the dialog so it sits right under it.
  const scrim = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const latest = useRef({ open, onClose, canClose });
  latest.current = { open, onClose, canClose };
  const hideScrim = () => {
    const s = scrim.current;
    if (s?.matches(':popover-open')) s.hidePopover();
  };
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) {
      resetMotion(d);
      const s = scrim.current;
      if (s && typeof s.showPopover === 'function') {
        resetMotion(s);
        hideScrim();
        s.showPopover();
      }
      d.showModal();
      // showModal focuses the first control, which is the × button: the dialog takes focus instead, so the
      // × does not show a focus ring when the sheet opens. Keyboard users still reach it with Tab.
      d.focus();
    }
    if (!open && d.open) {
      d.close();
      hideScrim();
    }
  }, [open]);

  // Closing from inside (×, Escape, backdrop) plays the exit first, then tells the owner.
  const requestClose = useCallback(() => {
    const d = ref.current;
    if (!d || closing.current) return;
    if (latest.current.canClose && !latest.current.canClose()) return;
    closing.current = true;
    leave(d, scrim.current).then(() => {
      closing.current = false;
      latest.current.onClose();
      // If the owner kept it open after all, show it again. Owners that close it by navigating
      // (the issue view) unmount it a few frames later, so wait well past that before deciding.
      setTimeout(() => {
        if (ref.current?.isConnected && latest.current.open && ref.current.open) resetMotion(ref.current);
      }, 600);
    });
  }, []);

  return (
    <>
      <div ref={scrim} popover="manual" className="dialog-scrim" data-for={className} aria-hidden="true" />
      <dialog
        ref={ref}
        tabIndex={-1}
        className={`dialog dialog-${size} ${className ?? ''}`}
        onClose={(e) => {
          if (e.target !== e.currentTarget) return;
          hideScrim();
          onClose();
        }}
        onCancel={(e) => {
          // Escape. Events from a dialog nested in this one (e.g. the image viewer) are theirs.
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          requestClose();
        }}
        onClick={(e) => {
          // Backdrop click: the event targets the <dialog> itself, outside its box.
          const r = e.currentTarget.getBoundingClientRect();
          if (e.target === e.currentTarget && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) requestClose();
        }}
      >
        {open && (
          <>
            <div className="dialog-header">
              <h2 className="dialog-title">{title}</h2>
              {actions && <div className="dialog-actions">{actions}</div>}
              <button type="button" className="icon-btn icon-btn-sm icon-btn-plain dialog-close" onClick={requestClose} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className={`dialog-body ${bodyClassName ?? ''}`}>{children}</div>
            {footer && <div className="dialog-footer">{footer}</div>}
          </>
        )}
      </dialog>
    </>
  );
}
