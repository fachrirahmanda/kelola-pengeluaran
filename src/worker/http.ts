import type { ApiError } from '../shared/types';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, { status, headers });
}

export function errorJson(status: number, message: string): Response {
  const body: ApiError = { error: message };
  return json(body, status);
}

/** Parses a JSON request body. Rejects anything that is not sent as application/json. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    throw new HttpError(415, 'Permintaan harus berupa JSON');
  }
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new HttpError(400, 'Data tidak valid');
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Data tidak valid');
  }
}
