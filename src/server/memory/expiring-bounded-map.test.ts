import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("ExpiringBoundedMap", () => {
  it("does not evict live entries and fails closed at capacity", async () => {
    const { ExpiringBoundedMap } = await import("./expiring-bounded-map");
    const values = new ExpiringBoundedMap<string, { expiresAt: number; value: string }>(2);
    expect(values.set("a", { expiresAt: 100, value: "a" }, 0)).toBe(true);
    expect(values.set("b", { expiresAt: 100, value: "b" }, 0)).toBe(true);
    expect(values.set("c", { expiresAt: 100, value: "c" }, 0)).toBe(false);
    expect(values.get("a")?.value).toBe("a");
    expect(values.get("c")).toBeUndefined();
  });

  it("releases expired capacity and permits an existing-key update", async () => {
    const { ExpiringBoundedMap } = await import("./expiring-bounded-map");
    const values = new ExpiringBoundedMap<string, { expiresAt: number; value: string }>(1);
    expect(values.set("a", { expiresAt: 10, value: "first" }, 0)).toBe(true);
    expect(values.set("a", { expiresAt: 20, value: "updated" }, 1)).toBe(true);
    expect(values.set("b", { expiresAt: 30, value: "second" }, 20)).toBe(true);
    expect(values.get("a")).toBeUndefined();
    expect(values.delete("b")).toBe(true);
    expect(values.delete("b")).toBe(false);
  });

  it("rejects invalid capacities and clocks", async () => {
    const { ExpiringBoundedMap } = await import("./expiring-bounded-map");
    expect(() => new ExpiringBoundedMap(0)).toThrow(RangeError);
    expect(() => new ExpiringBoundedMap(1.5)).toThrow(RangeError);
    const values = new ExpiringBoundedMap<string, { expiresAt: number }>(1);
    expect(() => values.prune(Number.NaN)).toThrow(RangeError);
    expect(() => values.set("a", { expiresAt: 1 }, -1)).toThrow(RangeError);
    expect(values.set("a", { expiresAt: Number.NaN }, 0)).toBe(false);
    expect(values.set("a", { expiresAt: 0 }, 0)).toBe(false);
  });
});
