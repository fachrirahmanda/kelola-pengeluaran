import { useState, type CSSProperties, type FormEvent } from 'react';
import { ApiRequestError } from '../api';
import { usePrefs } from '../prefs';
import { CATEGORY_COLORS, CATEGORY_ICONS, type Category, type CategoryInput } from '../../shared/types';

interface CategoryEditorProps {
  initial?: Category;
  submitLabel: string;
  /** Throws on failure. The error message is shown in the form. */
  onSave: (input: CategoryInput) => Promise<void>;
  onCancel?: () => void;
}

export function CategoryEditor({ initial, submitLabel, onSave, onCancel }: CategoryEditorProps) {
  const { t } = usePrefs();
  // The stored name, not the translated one: saving an untouched default must not rename it.
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? CATEGORY_COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon ?? CATEGORY_ICONS[0]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSave({ name, color, icon });
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="stack-lg">
      <label className="tx-field">
        <span className="tx-field-label">{t('cat.name')}</span>
        <input type="text" className="input" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} required />
      </label>

      <div className="tx-field">
        <span className="tx-field-label">{t('cat.color')}</span>
        <div className="swatches" role="radiogroup" aria-label={t('cat.color')}>
          {CATEGORY_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              className="swatch"
              aria-label={t('cat.colorLabel', { color: option })}
              aria-checked={color === option}
              style={{ '--swatch-color': option } as CSSProperties}
              onClick={() => setColor(option)}
            />
          ))}
        </div>
      </div>

      <div className="tx-field">
        <span className="tx-field-label">{t('cat.icon')}</span>
        <div className="chip-row" role="radiogroup" aria-label={t('cat.iconGroup')}>
          {CATEGORY_ICONS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              className="pill pill-icon"
              aria-checked={icon === option}
              onClick={() => setIcon(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? t('form.saving') : submitLabel}
        </button>
      </div>
    </form>
  );
}
