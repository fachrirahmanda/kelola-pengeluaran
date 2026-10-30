import { useState, type CSSProperties } from 'react';
import { api, ApiRequestError } from '../api';
import { CategoryEditor } from './CategoryEditor';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { SkeletonRows } from './Skeleton';
import { useCategories } from '../data';
import { usePrefs } from '../prefs';
import type { Category, CategoryInput } from '../../shared/types';

// Categories in Settings: a grid of tiles, each with its icon and colour. Adding and editing open in a
// dialog; the buttons are icons, with their names kept for screen readers and as tooltips.

type Editing = { mode: 'create' } | { mode: 'edit'; category: Category } | null;

/** Categories section of the Settings page: add, rename, recolor, change icon, delete. */
export function CategoriesSection() {
  const { t, categoryName } = usePrefs();
  const { categories, reload } = useCategories();
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState('');

  async function create(input: CategoryInput) {
    await api.post('/categories', input);
    window.DS?.toast(t('cat.added', { name: input.name }), { variant: 'success' });
    setEditing(null);
    await reload();
  }

  async function update(category: Category, input: CategoryInput) {
    await api.patch(`/categories/${category.id}`, input);
    setEditing(null);
    window.DS?.toast(t('cat.updated'), { variant: 'success' });
    await reload();
  }

  async function remove(category: Category) {
    if (!window.confirm(t('cat.confirmDelete', { name: categoryName(category.name) }))) return;
    setError('');
    try {
      await api.delete(`/categories/${category.id}`);
      window.DS?.toast(t('cat.deleted'));
      await reload();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('cat.deleteError'));
    }
  }

  return (
    <section className="settings-section" aria-labelledby="settings-categories">
      <div className="cat-head">
        <div className="grow">
          <h3 id="settings-categories">{t('cat.title')}</h3>
          <p className="hint">{t('cat.subtitle')}</p>
        </div>
        <button type="button" className="cat-add" onClick={() => setEditing({ mode: 'create' })} aria-label={t('cat.create')} title={t('cat.create')}>
          <Icon name="plus" size={18} />
        </button>
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      {categories === null ? (
        <SkeletonRows count={6} />
      ) : (
        <div className="cat-grid">
          {categories.map((category) => (
            <article key={category.id} className="cat-tile" style={{ '--cat-color': category.color } as CSSProperties}>
              <div className="cat-tile-head">
                <span className="cat-badge cat-badge-lg" style={{ '--cat-color': category.color } as CSSProperties} aria-hidden="true">
                  {category.icon}
                </span>
                <div className="cat-tile-actions">
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm icon-btn-plain"
                    onClick={() => setEditing({ mode: 'edit', category })}
                    aria-label={t('cat.edit')}
                    title={t('cat.edit')}
                  >
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm icon-btn-plain text-danger"
                    onClick={() => void remove(category)}
                    aria-label={t('cat.delete')}
                    title={t('cat.delete')}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
              <span className="cat-tile-name truncate">{categoryName(category.name)}</span>
            </article>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing?.mode === 'edit' ? t('cat.edit') : t('cat.addTitle')}>
        {editing?.mode === 'create' && <CategoryEditor submitLabel={t('cat.create')} onSave={create} onCancel={() => setEditing(null)} />}
        {editing?.mode === 'edit' && (
          <CategoryEditor
            key={editing.category.id}
            initial={editing.category}
            submitLabel={t('form.save')}
            onSave={(input) => update(editing.category, input)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>
    </section>
  );
}
