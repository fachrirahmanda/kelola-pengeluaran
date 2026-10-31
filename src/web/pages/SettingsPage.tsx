import { BanksSection } from '../components/BanksSection';
import { useSearchParams } from 'react-router';
import { useAuth } from '../auth';
import { AiSection } from '../components/AiSection';
import { CategoriesSection } from '../components/CategoriesSection';
import { WorkspaceSection } from '../components/WorkspaceSection';
import { DriveSection } from '../components/DriveSection';
import { usePrefs } from '../prefs';

export function SettingsPage() {
  const { t } = usePrefs();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  // Storage and Ask AI belong to the admin. Other people don't get those tabs at all.
  const isAdmin = !!user?.isAdmin;
  // The tab comes from the URL, so a link (and the Google Drive return) can open it directly.
  const requested = params.get('tab') ?? 'categories';

  const tabs = [
    { id: 'categories', label: t('settings.tabCategories') },
    { id: 'banks', label: t('settings.tabBanks') },
    { id: 'workspace', label: t('settings.tabWorkspace') },
    ...(isAdmin ? [{ id: 'storage', label: t('settings.tabStorage') }, { id: 'ai', label: t('ai.title') }] : []),
  ];
  const tab = tabs.some((item) => item.id === requested) ? requested : 'categories';
  const setTab = (id: string) => setParams({ tab: id }, { replace: true });

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('settings.title')}</h2>
          <p className="hint">{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="tabs settings-tabs" role="tablist" aria-label={t('settings.title')}>
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" className="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'categories' && <CategoriesSection />}
      {tab === 'banks' && <BanksSection />}
      {tab === 'workspace' && <WorkspaceSection />}
      {tab === 'storage' && isAdmin && <DriveSection />}
      {tab === 'ai' && isAdmin && <AiSection />}
    </>
  );
}
