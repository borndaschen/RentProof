import type { JsonStateFilesystemPort } from "@/application/repositories";

export class MemoryJsonStateFilesystem implements JsonStateFilesystemPort {
  readonly #documents = new Map<string, string>();

  async readText(storageKey: string): Promise<string | null> {
    return this.#documents.get(storageKey) ?? null;
  }

  async writeTextIfUnchanged(
    storageKey: string,
    expectedText: string | null,
    nextText: string,
  ): Promise<boolean> {
    const current = this.#documents.get(storageKey) ?? null;
    if (current !== expectedText) {
      return false;
    }
    this.#documents.set(storageKey, nextText);
    return true;
  }

  seedRaw(storageKey: string, raw: string): void {
    this.#documents.set(storageKey, raw);
  }

  readRaw(storageKey: string): string | null {
    return this.#documents.get(storageKey) ?? null;
  }
}
