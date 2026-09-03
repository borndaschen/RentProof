import type { PrivateUploadRecord } from "./contracts";

export class InMemoryPrivateUploadReceiptStore {
  readonly #recordsByReceipt = new Map<string, PrivateUploadRecord>();
  readonly #receiptByArtifact = new Map<string, string>();

  hasArtifact(artifactId: string): boolean {
    return this.#receiptByArtifact.has(artifactId);
  }

  originalImageBytes(caseId: "golden-v1"): number {
    let total = 0;
    for (const record of this.#recordsByReceipt.values()) {
      if (record.caseId === caseId && record.privatePayload.type === "image") {
        total += record.originalByteLength;
      }
    }
    return total;
  }

  save(record: PrivateUploadRecord): boolean {
    if (
      this.#receiptByArtifact.has(record.artifactId) ||
      this.#recordsByReceipt.has(record.receipt.receiptId)
    ) {
      return false;
    }
    const copy = clonePrivateRecord(record);
    this.#recordsByReceipt.set(copy.receipt.receiptId, copy);
    this.#receiptByArtifact.set(copy.artifactId, copy.receipt.receiptId);
    return true;
  }

  getPrivate(receiptId: string): PrivateUploadRecord | null {
    const record = this.#recordsByReceipt.get(receiptId);
    return record ? clonePrivateRecord(record) : null;
  }
}

function clonePrivateRecord(record: PrivateUploadRecord): PrivateUploadRecord {
  return {
    ...record,
    receipt: structuredClone(record.receipt),
    privatePayload:
      record.privatePayload.type === "image"
        ? {
            type: "image",
            derivativeBytes: Uint8Array.from(record.privatePayload.derivativeBytes),
          }
        : { type: "pdf", extracted: structuredClone(record.privatePayload.extracted) },
  };
}
