import { useLayoutEffect, useRef } from 'react';

// Small motion helpers on the Web Animations API: they animate elements in place, so nothing
// remounts (no refetching, no lost scroll or state). Everything is skipped for people who ask
// their system for reduced motion.

export const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

export const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A page arriving: fades in while rising a few pixels. */
export function enter(el: Element | null | undefined) {
  if (!el || reduceMotion()) return;
  el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE_OUT });
}

/**
 * Plays `enter` on the element `pick` returns whenever `key` changes (not on the first render,
 * when the page's own entrance runs, nor when the key was empty before).
 */
export function useEnterOnChange(key: string, pick: () => Element | null | undefined) {
  const last = useRef(key);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useLayoutEffect(() => {
    if (last.current === key) return;
    const from = last.current;
    last.current = key;
    // From no key (e.g. a redirect to the default section) is still the first render.
    if (from) enter(pickRef.current());
  }, [key]);
}

/**
 * A dialog leaving: plays its exit, then resolves. Side sheets slide back out, other dialogs
 * shrink and fade; the backdrop fades with them.
 */
export function leave(dialog: HTMLDialogElement, scrim?: HTMLElement | null) {
  if (reduceMotion()) return Promise.resolve();
  // The stylesheet says how each dialog leaves (--leave): side sheets slide right, phone bottom
  // sheets slide down, the rest shrink and fade.
  const how = getComputedStyle(dialog).getPropertyValue('--leave').trim() || (dialog.classList.contains('filter-sheet') ? 'right' : 'fade');
  const duration = how === 'fade' ? 160 : 240;
  const frames =
    how === 'right' ? [{ transform: 'none' }, { transform: 'translateX(100%)' }]
    : how === 'down' ? [{ transform: 'none' }, { transform: 'translateY(100%)' }]
    : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.97) translateY(6px)' }];
  const anim = dialog.animate(frames, { duration, easing: EASE_IN, fill: 'forwards' });
  scrim?.animate({ opacity: [1, 0] }, { duration, easing: EASE_IN, fill: 'forwards' });
  try {
    dialog.animate({ opacity: [1, 0] }, { duration, easing: EASE_IN, fill: 'forwards', pseudoElement: '::backdrop' });
  } catch {
    // Browsers without pseudo-element animations just drop the backdrop at the end.
  }
  return anim.finished.then(() => undefined, () => undefined);
}

/** Clears finished exit animations (they hold the last frame), e.g. before showing the dialog again. */
export const resetMotion = (el: Element) => el.getAnimations().forEach((a) => a.cancel());
