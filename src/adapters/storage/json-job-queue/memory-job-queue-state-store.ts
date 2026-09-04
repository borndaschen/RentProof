import type { JobQueueStateStore } from "@/application/jobs";

export class MemoryJobQueueStateStore implements JobQueueStateStore {
  #text: string | null = null;

  async readText(): Promise<string | null> {
    return this.#text;
  }

  async writeTextIfUnchanged(expectedText: string | null, nextText: string): Promise<boolean> {
    if (this.#text !== expectedText) return false;
    this.#text = nextText;
    return true;
  }

  seedRaw(raw: string | null): void {
    this.#text = raw;
  }

  readRaw(): string | null {
    return this.#text;
  }
}
