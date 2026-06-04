import type { Context } from 'hono'

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export function badRequest(message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(400, 'bad_request', message, details)
}

export function unauthorized(message = 'Unauthorized'): HttpError {
  return new HttpError(401, 'unauthorized', message)
}

export function notFound(message = 'Not found'): HttpError {
  return new HttpError(404, 'not_found', message)
}

export function jsonError(c: Context, error: unknown): Response {
  if (error instanceof HttpError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      error.status as never,
    )
  }

  const message = error instanceof Error ? error.message : String(error)
  return c.json(
    {
      ok: false,
      error: {
        code: 'internal_error',
        message,
      },
    },
    500,
  )
}
