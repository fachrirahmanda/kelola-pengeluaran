import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { useLiveRefresh } from './liveRefresh';
import type { Bank } from '../shared/banks';

// The data set's banks, loaded once for the whole app. A badge, a source form or the Banks settings reads them here.
// After a change the list is reloaded; a change someone else made arrives with the live refresh.

interface BanksState {
  banks: Bank[];
  reload: () => Promise<void>;
}

const BanksContext = createContext<BanksState>({ banks: [], reload: async () => undefined });

/** The banks of the data set. */
export function useBankList() {
  return useContext(BanksContext);
}

export function BanksProvider({ children }: { children: ReactNode }) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const refreshKey = useLiveRefresh();
  const reload = useCallback(
    () =>
      api
        .get<{ banks: Bank[] }>('/banks')
        .then((data) => setBanks(data.banks))
        .catch(() => undefined),
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  return <BanksContext value={{ banks, reload }}>{children}</BanksContext>;
}
