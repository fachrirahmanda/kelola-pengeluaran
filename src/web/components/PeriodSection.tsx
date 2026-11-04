import { useState } from 'react';
import { api, ApiRequestError } from '../api';
import { useWorkspace } from '../data';
import { usePrefs } from '../prefs';
import { MAX_PERIOD_START, MIN_PERIOD_START } from '../../shared/period';
import { Dropdown } from './Dropdown';
import { SkeletonSettingsCard } from './Skeleton';

// Settings → Periode: the day each monthly period starts. It belongs to the data set, so the owner and
// every member see the same periods.

/** Settings section: the day a monthly period starts. */
export function PeriodSection() {
  const { t } = usePrefs();
  const { state, reload, failed } = useWorkspace();
  const [error, setError] = useState('');

  if (state === null) {
    return failed ? null : <SkeletonSettingsCard lines={1} />;
  }
  const current = state.workspace.periodStartDay;
  const options = Array.from({ length: MAX_PERIOD_START - MIN_PERIOD_START + 1 }, (_, index) => {
    const day = index + MIN_PERIOD_START;
    return { value: String(day), label: day === 1 ? t('period.calendar') : t('period.day', { day }) };
  });

  async function change(value: string) {
    setError('');
    try {
      await api.put('/workspace/period-start', { day: Number(value) });
      window.DS?.toast(t('period.saved'), { variant: 'success' });
      await reload();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    }
  }

  return (
    <section className="settings-section" aria-labelledby="settings-period">
      <div className="settings-section-head">
        <h3 id="settings-period">{t('period.title')}</h3>
        <p className="hint">{t('period.hint')}</p>
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="card ws-card">
        <Dropdown value={String(current)} options={options} onChange={(value) => void change(value)} ariaLabel={t('period.title')} />
      </div>
    </section>
  );
}
