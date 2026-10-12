import { HTTPError } from 'h3'

/**
 * Expected request error (bad parameter, missing run, refused path), answered as `{ status, message }`.
 *
 * NOTICE: it extends H3's `HTTPError` because H3 logs every other thrown error as unhandled to stderr, which would
 * print stack traces for ordinary 404s into the terminal of a `vieval run --with-viewer`.
 */
export class ViewerError extends HTTPError {
  constructor(status: number, message: string) {
    super(message, { status })
  }
}
