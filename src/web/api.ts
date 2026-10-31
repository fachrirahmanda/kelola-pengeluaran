import type { ApiError } from '../shared/types';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Told the data set's new change count after each change this page makes (see useLiveRefresh). */
let onDataVersion: ((version: number) => void) | null = null;
export function listenDataVersion(listener: ((version: number) => void) | null) {
  onDataVersion = listener;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const version = Number(response.headers.get('x-data-version'));
  if (version) onDataVersion?.(version);

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data ? (data as ApiError).error : 'Terjadi kesalahan. Coba lagi.';
    throw new ApiRequestError(message, response.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
