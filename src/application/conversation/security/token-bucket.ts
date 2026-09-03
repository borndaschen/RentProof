import { CONVERSATION_LIMITS } from "@/domain/conversation";

type Bucket = {
  tokens: number;
  lastRefillMs: number;
  lastSeenMs: number;
};

export type ConversationRateLimitInput = {
  actorRef: string;
  sourceIp: string;
  nowMs?: number;
};

export type ConversationRateLimitResult =
  | { ok: true; remainingActorTokens: number; remainingSourceIpTokens: number }
  | {
      ok: false;
      code: "CONVERSATION_RATE_LIMITED" | "CONVERSATION_RATE_LIMITER_UNAVAILABLE";
      retryAfterSeconds: number;
    };

type BucketPolicy = {
  tokensPerMinute: number;
  burst: number;
};

export type InMemoryConversationRateLimiterOptions = {
  actor?: Partial<BucketPolicy>;
  sourceIp?: Partial<BucketPolicy>;
  maxBuckets?: number;
  idleTtlMs?: number;
};

const MILLIS_PER_MINUTE = 60_000;

export class InMemoryConversationRateLimiter {
  readonly #actorBuckets = new Map<string, Bucket>();
  readonly #sourceIpBuckets = new Map<string, Bucket>();
  readonly #actorPolicy: BucketPolicy;
  readonly #sourceIpPolicy: BucketPolicy;
  readonly #maxBuckets: number;
  readonly #idleTtlMs: number;

  constructor(options: InMemoryConversationRateLimiterOptions = {}) {
    this.#actorPolicy = {
      tokensPerMinute: options.actor?.tokensPerMinute ?? CONVERSATION_LIMITS.actorTokensPerMinute,
      burst: options.actor?.burst ?? CONVERSATION_LIMITS.actorBurst,
    };
    this.#sourceIpPolicy = {
      tokensPerMinute:
        options.sourceIp?.tokensPerMinute ?? CONVERSATION_LIMITS.sourceIpTokensPerMinute,
      burst: options.sourceIp?.burst ?? CONVERSATION_LIMITS.sourceIpBurst,
    };
    this.#maxBuckets = options.maxBuckets ?? 10_000;
    this.#idleTtlMs = options.idleTtlMs ?? 10 * MILLIS_PER_MINUTE;

    assertPolicy(this.#actorPolicy);
    assertPolicy(this.#sourceIpPolicy);
    if (!Number.isSafeInteger(this.#maxBuckets) || this.#maxBuckets < 2) {
      throw new RangeError("maxBuckets must be an integer of at least 2");
    }
    if (!Number.isFinite(this.#idleTtlMs) || this.#idleTtlMs <= 0) {
      throw new RangeError("idleTtlMs must be positive");
    }
  }

  consume(input: ConversationRateLimitInput): ConversationRateLimitResult {
    if (input.actorRef.length === 0 || input.sourceIp.length === 0) {
      return {
        ok: false,
        code: "CONVERSATION_RATE_LIMITER_UNAVAILABLE",
        retryAfterSeconds: 1,
      };
    }

    const nowMs = input.nowMs ?? Date.now();
    if (!Number.isFinite(nowMs) || nowMs < 0) {
      return {
        ok: false,
        code: "CONVERSATION_RATE_LIMITER_UNAVAILABLE",
        retryAfterSeconds: 1,
      };
    }

    this.#prune(nowMs);
    const newBucketCount =
      Number(!this.#actorBuckets.has(input.actorRef)) +
      Number(!this.#sourceIpBuckets.has(input.sourceIp));
    if (this.#bucketCount() + newBucketCount > this.#maxBuckets) {
      return {
        ok: false,
        code: "CONVERSATION_RATE_LIMITER_UNAVAILABLE",
        retryAfterSeconds: 1,
      };
    }

    const actor = this.#readBucket(this.#actorBuckets, input.actorRef, this.#actorPolicy, nowMs);
    const sourceIp = this.#readBucket(
      this.#sourceIpBuckets,
      input.sourceIp,
      this.#sourceIpPolicy,
      nowMs,
    );

    if (actor.tokens < 1 || sourceIp.tokens < 1) {
      const retryAfterMs = Math.max(
        actor.tokens < 1 ? millisecondsUntilToken(actor, this.#actorPolicy) : 0,
        sourceIp.tokens < 1 ? millisecondsUntilToken(sourceIp, this.#sourceIpPolicy) : 0,
      );
      return {
        ok: false,
        code: "CONVERSATION_RATE_LIMITED",
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)),
      };
    }

    actor.tokens -= 1;
    sourceIp.tokens -= 1;
    this.#actorBuckets.set(input.actorRef, actor);
    this.#sourceIpBuckets.set(input.sourceIp, sourceIp);
    return {
      ok: true,
      remainingActorTokens: Math.floor(actor.tokens),
      remainingSourceIpTokens: Math.floor(sourceIp.tokens),
    };
  }

  #readBucket(
    buckets: Map<string, Bucket>,
    key: string,
    policy: BucketPolicy,
    nowMs: number,
  ): Bucket {
    const existing = buckets.get(key);
    if (!existing) {
      return { tokens: policy.burst, lastRefillMs: nowMs, lastSeenMs: nowMs };
    }

    const effectiveNowMs = Math.max(nowMs, existing.lastRefillMs);
    const refill =
      ((effectiveNowMs - existing.lastRefillMs) * policy.tokensPerMinute) / MILLIS_PER_MINUTE;
    return {
      tokens: Math.min(policy.burst, existing.tokens + refill),
      lastRefillMs: effectiveNowMs,
      lastSeenMs: effectiveNowMs,
    };
  }

  #bucketCount(): number {
    return this.#actorBuckets.size + this.#sourceIpBuckets.size;
  }

  #prune(nowMs: number): void {
    pruneMap(this.#actorBuckets, nowMs, this.#idleTtlMs);
    pruneMap(this.#sourceIpBuckets, nowMs, this.#idleTtlMs);
  }
}

function assertPolicy(policy: BucketPolicy): void {
  if (!Number.isFinite(policy.tokensPerMinute) || policy.tokensPerMinute <= 0) {
    throw new RangeError("tokensPerMinute must be positive");
  }
  if (!Number.isFinite(policy.burst) || policy.burst < 1) {
    throw new RangeError("burst must be at least 1");
  }
}

function millisecondsUntilToken(bucket: Bucket, policy: BucketPolicy): number {
  return ((1 - bucket.tokens) * MILLIS_PER_MINUTE) / policy.tokensPerMinute;
}

function pruneMap(buckets: Map<string, Bucket>, nowMs: number, idleTtlMs: number): void {
  for (const [key, bucket] of buckets) {
    if (nowMs - bucket.lastSeenMs > idleTtlMs) {
      buckets.delete(key);
    }
  }
}
