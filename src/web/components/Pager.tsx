import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { usePrefs } from '../prefs';

// Pagination for long lists: a page of items, and a control under the list with previous and next buttons,
// and the page numbers between them. The list is sliced in the browser, so the page never asks the server
// for more than it needs.

/** The items on one page. The page is clamped, so a shorter list never shows an empty page. */
export function pageOf<T>(items: T[], page: number, size: number): T[] {
  const start = (Math.min(page, pageCountOf(items.length, size)) - 1) * size;
  return items.slice(start, start + size);
}

export const pageCountOf = (count: number, size: number) => Math.max(1, Math.ceil(count / size));

/** The current page, starting at 1, and going back to 1 whenever `resetKey` changes (for example, a new filter). */
export function usePage(count: number, size: number, resetKey?: unknown) {
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

export function Pager({ page, pages, onPage, count }: { page: number; pages: number; onPage: (page: number) => void; count: number }) {
  const { t } = usePrefs();
  if (count === 0 || pages <= 1) return null;
  return (
    <nav className="pager" aria-label={t('pager.label')}>
      <button type="button" className="pager-step" onClick={() => onPage(page - 1)} disabled={page <= 1}>
        <Icon name="chevron-right" size={14} className="pager-step-icon-prev" />
        <span>{t('pager.prevShort')}</span>
      </button>
      <div className="pager-pages">
        {visiblePages(page, pages).map((item, index) =>
          item === 'gap' ? (
            <span key={`gap-${index}`} className="pager-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className="pager-page"
              aria-current={item === page ? 'page' : undefined}
              aria-label={t('pager.page', { page: item })}
              onClick={() => onPage(item)}
            >
              {item}
            </button>
          ),
        )}
      </div>
      <button type="button" className="pager-step" onClick={() => onPage(page + 1)} disabled={page >= pages}>
        <span>{t('pager.nextShort')}</span>
        <Icon name="chevron-right" size={14} />
      </button>
    </nav>
  );
}
