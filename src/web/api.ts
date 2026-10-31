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
  if (!response.ok) throw new ApiRequestError(errorMessage(data), response.status);
  return data as T;
}

/** The server's { error } message, or a general one. */
function errorMessage(data: unknown) {
  return typeof data === 'object' && data !== null && 'error' in data ? (data as ApiError).error : 'Terjadi kesalahan. Coba lagi.';
}

/**
 * A POST whose answer arrives as it is written, one JSON object per line (application/x-ndjson). Each
 * object is passed to onEvent as soon as its line is complete. A refusal before the answer starts (a
 * 4xx or 5xx with { error }) throws like the other calls.
 */
export async function postStream<E>(path: string, body: unknown, onEvent: (event: E) => void): Promise<void> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(errorMessage(data), response.status);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as E);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
