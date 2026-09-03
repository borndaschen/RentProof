import {
  ServerFocusRecordSchema,
  type FocusRefSourcePort,
  type ServerFocusRecord,
} from "./focus-ref-resolver";

export class InMemoryFocusRefSource implements FocusRefSourcePort {
  readonly #records: Map<string, ServerFocusRecord>;

  constructor(untrustedRecords: readonly unknown[]) {
    const records = untrustedRecords.map((record) => ServerFocusRecordSchema.parse(record));
    if (new Set(records.map((record) => record.focusRefId)).size !== records.length) {
      throw new Error("DUPLICATE_FOCUS_REF_ID");
    }
    this.#records = new Map(records.map((record) => [record.focusRefId, record]));
  }

  async findById(focusRefId: string): Promise<ServerFocusRecord | null> {
    const record = this.#records.get(focusRefId);
    return record ? { ...record, sourceRefIds: [...record.sourceRefIds] } : null;
  }
}
