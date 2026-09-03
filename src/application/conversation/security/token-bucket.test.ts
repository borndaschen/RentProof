import { describe, expect, it } from "vitest";
import { InMemoryConversationRateLimiter } from "./token-bucket";

const actor = "actor_abcdefghijklmnopqrst";
const ip = "192.168.1.24";

describe("InMemoryConversationRateLimiter", () => {
  it("allows burst three and refills at ten tokens per minute", () => {
    const limiter = new InMemoryConversationRateLimiter();

    expect(limiter.consume({ actorRef: actor, sourceIp: ip, nowMs: 0 })).toMatchObject({
      ok: true,
      remainingActorTokens: 2,
      remainingSourceIpTokens: 2,
    });
    expect(limiter.consume({ actorRef: actor, sourceIp: ip, nowMs: 0 }).ok).toBe(true);
    expect(limiter.consume({ actorRef: actor, sourceIp: ip, nowMs: 0 }).ok).toBe(true);
    expect(limiter.consume({ actorRef: actor, sourceIp: ip, nowMs: 0 })).toEqual({
      ok: false,
      code: "CONVERSATION_RATE_LIMITED",
      retryAfterSeconds: 6,
    });
    expect(limiter.consume({ actorRef: actor, sourceIp: ip, nowMs: 5_999 }).ok).toBe(false);
    expect(limiter.consume({ actorRef: actor, sourceIp: ip, nowMs: 6_000 }).ok).toBe(true);
  });

  it("applies actor and source-IP buckets independently", () => {
    const actorLimited = new InMemoryConversationRateLimiter();
    for (let index = 0; index < 3; index += 1) {
      expect(
        actorLimited.consume({ actorRef: actor, sourceIp: `192.168.1.${index + 1}`, nowMs: 0 }).ok,
      ).toBe(true);
    }
    expect(actorLimited.consume({ actorRef: actor, sourceIp: "192.168.1.99", nowMs: 0 }).ok).toBe(
      false,
    );

    const ipLimited = new InMemoryConversationRateLimiter();
    for (let index = 0; index < 3; index += 1) {
      expect(
        ipLimited.consume({
          actorRef: `${actor}_${index}`,
          sourceIp: ip,
          nowMs: 0,
        }).ok,
      ).toBe(true);
    }
    expect(ipLimited.consume({ actorRef: `${actor}_other`, sourceIp: ip, nowMs: 0 }).ok).toBe(
      false,
    );
  });

  it("does not spend an available actor token when the IP bucket rejects", () => {
    const limiter = new InMemoryConversationRateLimiter();
    for (let index = 0; index < 3; index += 1) {
      expect(limiter.consume({ actorRef: `${actor}_${index}`, sourceIp: ip, nowMs: 0 }).ok).toBe(
        true,
      );
    }

    expect(limiter.consume({ actorRef: actor, sourceIp: ip, nowMs: 0 }).ok).toBe(false);
    expect(limiter.consume({ actorRef: actor, sourceIp: "192.168.1.200", nowMs: 0 })).toMatchObject(
      { ok: true, remainingActorTokens: 2 },
    );
  });

  it("fails closed for invalid keys, time, or exhausted bucket storage", () => {
    const limiter = new InMemoryConversationRateLimiter({ maxBuckets: 2 });
    expect(limiter.consume({ actorRef: "", sourceIp: ip })).toMatchObject({
      ok: false,
      code: "CONVERSATION_RATE_LIMITER_UNAVAILABLE",
    });
    expect(limiter.consume({ actorRef: actor, sourceIp: ip, nowMs: Number.NaN })).toMatchObject({
      ok: false,
      code: "CONVERSATION_RATE_LIMITER_UNAVAILABLE",
    });
    expect(limiter.consume({ actorRef: actor, sourceIp: ip, nowMs: 0 }).ok).toBe(true);
    expect(limiter.consume({ actorRef: `${actor}_new`, sourceIp: ip, nowMs: 0 })).toMatchObject({
      ok: false,
      code: "CONVERSATION_RATE_LIMITER_UNAVAILABLE",
    });
  });

  it("rejects invalid policies", () => {
    expect(() => new InMemoryConversationRateLimiter({ actor: { tokensPerMinute: 0 } })).toThrow(
      RangeError,
    );
    expect(() => new InMemoryConversationRateLimiter({ sourceIp: { burst: 0 } })).toThrow(
      RangeError,
    );
    expect(() => new InMemoryConversationRateLimiter({ idleTtlMs: 0 })).toThrow(RangeError);
  });
});
