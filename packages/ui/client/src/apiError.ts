/** A Viewer request failure, with 0 for an unreachable data source. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}
