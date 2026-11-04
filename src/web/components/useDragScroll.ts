import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';

// Drag a row sideways with the mouse, like a phone's swipe. Touch already scrolls the row natively. A drag does
// not count as a click, so releasing over a link after dragging does not open it.

export function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; left: number } | null>(null);
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !ref.current) return;
    start.current = { x: event.clientX, left: ref.current.scrollLeft };
    moved.current = false;
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const origin = start.current;
    const element = ref.current;
    if (!origin || !element) return;
    const dx = event.clientX - origin.x;
    if (!moved.current) {
      if (Math.abs(dx) < 4) return;
      moved.current = true;
      setDragging(true);
    }
    element.scrollLeft = origin.left - dx;
  }

  function endDrag() {
    start.current = null;
    setDragging(false);
  }

  // The click that follows a drag is dropped, so the link under the pointer is not followed.
  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!moved.current) return;
    event.preventDefault();
    event.stopPropagation();
    moved.current = false;
  }

  return {
    ref,
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerLeave: endDrag,
      onPointerCancel: endDrag,
      onClickCapture,
      onDragStart: (event: MouseEvent<HTMLDivElement>) => event.preventDefault(),
    },
  };
}
