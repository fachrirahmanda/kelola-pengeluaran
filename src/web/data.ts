import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Category, Invitation, OpenBill, PaidBill, PaymentSource, RecurringItem, RecurringPayment, Workspace } from '../shared/types';

/** Loads the user's categories. Call `reload` after they change. */
export function useCategories() {
  const [categories, setCategories] = useState<Category[] | null>(null);

  const reload = useCallback(() => api.get<{ categories: Category[] }>('/categories').then((data) => setCategories(data.categories)), []);
  useEffect(() => {
    reload().catch(() => setCategories([]));
  }, [reload]);

  return { categories, reload };
}

/** Loads the user's sources of funds (savings, credit cards, paylater). Call `reload` after they change. */
export function useSources() {
  const [sources, setSources] = useState<PaymentSource[] | null>(null);

  const reload = useCallback(() => api.get<{ sources: PaymentSource[] }>('/sources').then((data) => setSources(data.sources)), []);
  useEffect(() => {
    reload().catch(() => setSources([]));
  }, [reload]);

  return { sources, reload };
}

/** Loads open bills and the paid bill history. Call `reload` after a bill is paid. */
export function useBills() {
  const [bills, setBills] = useState<{ open: OpenBill[]; paid: PaidBill[] } | null>(null);

  const reload = useCallback(() => api.get<{ open: OpenBill[]; paid: PaidBill[] }>('/bills').then((data) => setBills(data)), []);
  useEffect(() => {
    reload().catch(() => setBills({ open: [], paid: [] }));
  }, [reload]);

  return { bills, reload };
}

/** Loads installments and recurring payments. Call `reload` after a change. */
export function useRecurring() {
  const [data, setData] = useState<{ items: RecurringItem[]; upcoming: RecurringItem[]; payments: RecurringPayment[] } | null>(null);

  const reload = useCallback(
    () => api.get<{ items: RecurringItem[]; upcoming: RecurringItem[]; payments: RecurringPayment[] }>('/recurring').then((result) => setData(result)),
    [],
  );
  useEffect(() => {
    reload().catch(() => setData({ items: [], upcoming: [], payments: [] }));
  }, [reload]);

  return { data, reload };
}

/** The shared data set, its members, and invitations for the signed-in person. */
export function useWorkspace() {
  const [state, setState] = useState<{ workspace: Workspace; invitations: Invitation[] } | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(
    () =>
      api
        .get<{ workspace: Workspace; invitations: Invitation[] }>('/workspace')
        .then((data) => {
          setFailed(false);
          setState(data);
        })
        .catch(() => {
          setState(null);
          setFailed(true);
        }),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, reload, failed };
}
