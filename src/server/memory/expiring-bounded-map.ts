import "server-only";

type ExpiringValue = Readonly<{ expiresAt: number }>;

export class ExpiringBoundedMap<K, V extends ExpiringValue> {
  readonly #entries = new Map<K, V>();
  readonly #maximumEntries: number;

  constructor(maximumEntries: number) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
      throw new RangeError("maximumEntries must be a positive safe integer");
    }
    this.#maximumEntries = maximumEntries;
  }

  get(key: K): V | undefined {
    return this.#entries.get(key);
  }

  delete(key: K): boolean {
    return this.#entries.delete(key);
  }

  set(key: K, value: V, now = Date.now()): boolean {
    this.prune(now);
    if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now) return false;
    if (!this.#entries.has(key) && this.#entries.size >= this.#maximumEntries) return false;
    this.#entries.set(key, value);
    return true;
  }

  prune(now = Date.now()): void {
    if (!Number.isSafeInteger(now) || now < 0) throw new RangeError("now must be a safe timestamp");
    for (const [key, value] of this.#entries) {
      if (value.expiresAt <= now) this.#entries.delete(key);
    }
  }
}
