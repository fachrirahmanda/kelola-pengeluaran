import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { usePrefs } from '../prefs';

// Pagination for long lists: a page of items, and a control under the list. The control has round buttons:
// first, previous, the page numbers (the current one filled), next and last. The list is sliced in the
// browser, so the page never asks the server for more than it needs.

/** The items on one page. The page is clamped, so a shorter list never shows an empty page. */
export function pageOf<T>(items: T[], page: number, size: number): T[] {
  const start = (Math.min(page, pageCountOf(items.length, size)) - 1) * size;
  return items.slice(start, start + size);
}

export const pageCountOf = (count: number, size: number) => Math.max(1, Math.ceil(count / size));

/**
 * The current page, starting at 1. It goes back to 1 whenever `resetKey` changes (for example, a new filter).
 * The key is a string, so a caller that builds it each render does not reset the page on every render.
 */
export function usePage(count: number, size: number, resetKey = '') {
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [resetKey]);
  const pages = pageCountOf(count, size);
  return { page: Math.min(page, pages), pages, setPage };
}

/** Page numbers to show: all of them when there are few; otherwise the first, the last, and the ones around the current page. */
function visiblePages(page: number, pages: number): (number | 'gap')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const shown = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...shown].sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];
  sorted.forEach((n, index) => {
    if (index > 0 && n - sorted[index - 1] > 1) result.push('gap');
    result.push(n);
  });
  return result;
}

/** Two chevrons side by side, for the first and last buttons. */
function DoubleChevron({ flip }: { flip?: boolean }) {
  return (
    <span className={`pager-round-chev${flip ? ' is-flipped' : ''}`} aria-hidden="true">
      <Icon name="chevron-right" size={14} />
      <Icon name="chevron-right" size={14} />
    </span>
  );
}

export function Pager({ page, pages, onPage, count }: { page: number; pages: number; onPage: (page: number) => void; count: number }) {
  const { t } = usePrefs();
  if (count === 0 || pages <= 1) return null;
  return (
    <nav className="pager-round" aria-label={t('pager.label')}>
      <button type="button" className="pager-round-btn" onClick={() => onPage(1)} disabled={page <= 1} aria-label={t('pager.first')} title={t('pager.first')}>
        <DoubleChevron flip />
      </button>
      <button type="button" className="pager-round-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label={t('pager.prev')} title={t('pager.prev')}>
        <Icon name="chevron-right" size={16} className="pager-round-prev" />
      </button>
      {visiblePages(page, pages).map((item, index) =>
        item === 'gap' ? (
          <span key={`gap-${index}`} className="pager-round-gap" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className="pager-round-btn"
            aria-current={item === page ? 'page' : undefined}
            aria-label={t('pager.page', { page: item })}
            onClick={() => onPage(item)}
          >
            {item}
          </button>
        ),
      )}
      <button type="button" className="pager-round-btn" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label={t('pager.next')} title={t('pager.next')}>
        <Icon name="chevron-right" size={16} />
      </button>
      <button type="button" className="pager-round-btn" onClick={() => onPage(pages)} disabled={page >= pages} aria-label={t('pager.last')} title={t('pager.last')}>
        <DoubleChevron />
      </button>
    </nav>
  );
}
