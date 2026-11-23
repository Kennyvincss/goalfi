/** Errors carrying an HTTP-ish status so both the web API and the bot can render them. */
export class ServiceError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
    this.name = "ServiceError";
  }
}

export const notFound = (what = "Not found") => new ServiceError(404, what);
export const forbidden = (why = "You are not allowed to do that") => new ServiceError(403, why);
export const conflict = (why: string) => new ServiceError(409, why);
export const invalid = (why: string, details?: unknown) => new ServiceError(422, why, details);

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}
