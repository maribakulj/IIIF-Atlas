export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new HttpError(400, "bad_request", msg, details);
export const notFound = (msg = "Not found") => new HttpError(404, "not_found", msg);
export const unprocessable = (msg: string, details?: unknown) =>
  new HttpError(422, "unprocessable_entity", msg, details);
export const tooManyRequests = (msg = "Too many requests", details?: unknown) =>
  new HttpError(429, "too_many_requests", msg, details);
export const serverError = (msg = "Internal error", details?: unknown) =>
  new HttpError(500, "internal_error", msg, details);
