import type { EnumerationResistancePort } from "@/application/auth";

export class MinimumResponseFloor implements EnumerationResistancePort {
  constructor(private readonly minimumMilliseconds: number) {
    if (
      !Number.isInteger(minimumMilliseconds) ||
      minimumMilliseconds < 250 ||
      minimumMilliseconds > 2_000
    ) {
      throw new Error("AUTH_RESPONSE_FLOOR_INVALID");
    }
  }

  async complete(startedAt: number): Promise<void> {
    const remaining = Math.max(0, this.minimumMilliseconds - (Date.now() - startedAt));
    if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }
}
