/** Boundary-safe error model: only `{ code, message, details }` crosses the
 *  runtime boundary; each consumer language rehydrates a typed exception. */

export type ErrorCode =
  | 'connection_failed'
  | 'query_failed'
  | 'unknown_query_id'
  | 'bad_params'
  | 'timeout'
  | 'lock_held'
  | 'rate_limited'
  | 'unsupported_feature';

export interface BoundaryError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class HyperDbError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HyperDbError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  /** New error with extra context merged into details (existing keys win). */
  withContext(context: Record<string, unknown>): HyperDbError {
    return new HyperDbError(this.code, this.message, { ...context, ...this.details });
  }

  toBoundary(): BoundaryError {
    const wire: BoundaryError = { code: this.code, message: this.message };
    if (this.details !== undefined) wire.details = this.details;
    return wire;
  }

  static fromBoundary(wire: BoundaryError): HyperDbError {
    return new HyperDbError(wire.code, wire.message, wire.details);
  }

  static wrap(err: unknown, code: ErrorCode = 'query_failed'): HyperDbError {
    if (err instanceof HyperDbError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new HyperDbError(code, message);
  }
}
