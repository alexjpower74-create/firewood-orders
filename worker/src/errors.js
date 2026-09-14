// One error type for every refusal. Pure (no Worker APIs) so the unit tests can check codes.
export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export const bad = (field, message) => new ApiError(400, 'bad_request', message, { field })
export const notFound = (message = "We couldn't find that.") => new ApiError(404, 'not_found', message)
export const badState = (message) => new ApiError(409, 'bad_state', message)
