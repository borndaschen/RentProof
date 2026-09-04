export const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
export const AUTH_RATE_LIMIT_MAX = 10;
export const AUTH_RATE_LIMIT_MAX_COUNTERS = 10_000;
const AUTH_RATE_LIMIT_MAX_SCOPE_LENGTH = 512;

type Counter = { startedAt: number; count: number };

export class AuthRequestRateLimiter {
  readonly #counters = new Map<string, Counter>();
  readonly #maxCounters: number;

  constructor(maxCounters = AUTH_RATE_LIMIT_MAX_COUNTERS) {
    if (!Number.isSafeInteger(maxCounters) || maxCounters < 1) {
      throw new RangeError("maxCounters must be a positive safe integer");
    }
    this.#maxCounters = maxCounters;
  }

  take(
    scope: string,
    now = Date.now(),
  ): Readonly<{ allowed: boolean; retryAfterSeconds?: number }> {
    if (
      scope.length === 0 ||
      scope.length > AUTH_RATE_LIMIT_MAX_SCOPE_LENGTH ||
      !Number.isSafeInteger(now) ||
      now < 0
    ) {
      return { allowed: false, retryAfterSeconds: 1 };
    }
    this.#prune(now);
    const current = this.#counters.get(scope);
    if (!current) {
      if (this.#counters.size >= this.#maxCounters) {
        return {
          allowed: false,
          retryAfterSeconds: this.#capacityRetryAfterSeconds(now),
        };
      }
      this.#counters.set(scope, { startedAt: now, count: 1 });
      return { allowed: true };
    }
    const effectiveNow = Math.max(now, current.startedAt);
    if (effectiveNow - current.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      this.#counters.set(scope, { startedAt: effectiveNow, count: 1 });
      return { allowed: true };
    }
    if (current.count >= AUTH_RATE_LIMIT_MAX) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.startedAt + AUTH_RATE_LIMIT_WINDOW_MS - effectiveNow) / 1_000),
        ),
      };
    }
    current.count += 1;
    return { allowed: true };
  }

  reset(): void {
    this.#counters.clear();
  }

  #prune(now: number): void {
    for (const [scope, counter] of this.#counters) {
      if (now - counter.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) this.#counters.delete(scope);
    }
  }

  #capacityRetryAfterSeconds(now: number): number {
    let earliestExpiry = Number.POSITIVE_INFINITY;
    for (const counter of this.#counters.values()) {
      earliestExpiry = Math.min(earliestExpiry, counter.startedAt + AUTH_RATE_LIMIT_WINDOW_MS);
    }
    return Math.min(
      AUTH_RATE_LIMIT_WINDOW_MS / 1_000,
      Math.max(1, Math.ceil((earliestExpiry - now) / 1_000)),
    );
  }
}

export const selfHostedAuthRateLimiter = new AuthRequestRateLimiter();
