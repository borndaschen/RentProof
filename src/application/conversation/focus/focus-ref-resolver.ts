import { z } from "zod";
import { OpaqueIdSchema, ValidatedFocusRefSchema } from "@/domain/conversation";
import { detectSensitiveConversationContent } from "../security";

const FocusKindSchema = z.enum([
  "assistant_card",
  "finding",
  "claim",
  "contract_clause",
  "action",
  "source_locator",
]);

export const ServerFocusRecordSchema = z
  .object({
    focusRefId: OpaqueIdSchema,
    actorRef: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    snapshotId: OpaqueIdSchema,
    kind: FocusKindSchema,
    label: z.string().min(1).max(120),
    verifiedSummary: z.string().min(1).max(400),
    sourceRefIds: z.array(OpaqueIdSchema).max(5),
  })
  .strict();

export type ServerFocusRecord = z.infer<typeof ServerFocusRecordSchema>;

export interface FocusRefSourcePort {
  findById(focusRefId: string): Promise<ServerFocusRecord | null>;
}

const ResolveFocusRefInputSchema = z
  .object({
    actorRef: OpaqueIdSchema,
    caseId: OpaqueIdSchema,
    snapshotId: OpaqueIdSchema.nullable(),
    candidateFocusRefId: z.string().max(256).nullable(),
    referenceRequirement: z.enum(["optional", "required"]),
    allowedKinds: z.array(FocusKindSchema).min(1).max(6),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.allowedKinds).size !== input.allowedKinds.length) {
      context.addIssue({ code: "custom", message: "DUPLICATE_ALLOWED_FOCUS_KIND" });
    }
  });

export type ResolveFocusRefInput = z.input<typeof ResolveFocusRefInputSchema>;

export type ResolveFocusRefResult =
  | { ok: true; focusRefs: z.infer<typeof ValidatedFocusRefSchema>[] }
  | {
      ok: false;
      code:
        | "CONVERSATION_FOCUS_REQUIRED"
        | "CONVERSATION_FOCUS_NOT_FOUND"
        | "CONVERSATION_FOCUS_STALE"
        | "CONVERSATION_FOCUS_FORBIDDEN";
    };

export class ServerOwnedFocusRefResolver {
  readonly #source: FocusRefSourcePort;

  constructor(source: FocusRefSourcePort) {
    this.#source = source;
  }

  async resolve(untrustedInput: unknown): Promise<ResolveFocusRefResult> {
    const parsed = ResolveFocusRefInputSchema.safeParse(untrustedInput);
    if (!parsed.success) {
      return { ok: false, code: "CONVERSATION_FOCUS_FORBIDDEN" };
    }
    const input = parsed.data;

    if (input.candidateFocusRefId === null || input.candidateFocusRefId.length === 0) {
      return input.referenceRequirement === "required"
        ? { ok: false, code: "CONVERSATION_FOCUS_REQUIRED" }
        : { ok: true, focusRefs: [] };
    }
    if (!OpaqueIdSchema.safeParse(input.candidateFocusRefId).success) {
      return { ok: false, code: "CONVERSATION_FOCUS_NOT_FOUND" };
    }

    const record = await this.#source.findById(input.candidateFocusRefId);
    if (!record) {
      return { ok: false, code: "CONVERSATION_FOCUS_NOT_FOUND" };
    }
    if (record.actorRef !== input.actorRef || record.caseId !== input.caseId) {
      return { ok: false, code: "CONVERSATION_FOCUS_FORBIDDEN" };
    }
    if (input.snapshotId === null || record.snapshotId !== input.snapshotId) {
      return { ok: false, code: "CONVERSATION_FOCUS_STALE" };
    }
    if (!input.allowedKinds.includes(record.kind)) {
      return { ok: false, code: "CONVERSATION_FOCUS_FORBIDDEN" };
    }
    if (!isSafeProjectionText(record.label) || !isSafeProjectionText(record.verifiedSummary)) {
      return { ok: false, code: "CONVERSATION_FOCUS_FORBIDDEN" };
    }

    const projection = ValidatedFocusRefSchema.safeParse({
      focusRefId: record.focusRefId,
      kind: record.kind,
      snapshotId: record.snapshotId,
      label: record.label.normalize("NFC"),
      verifiedSummary: record.verifiedSummary.normalize("NFC"),
      sourceRefIds: [...record.sourceRefIds],
    });
    if (!projection.success) {
      return { ok: false, code: "CONVERSATION_FOCUS_FORBIDDEN" };
    }
    return { ok: true, focusRefs: [projection.data] };
  }
}

const PATH_PATTERNS: readonly RegExp[] = [
  /[a-z]:[\\/]/iu,
  /\\\\[^\\\s]+\\[^\\\s]+/u,
  /\/(?:home|users|var|etc|tmp|mnt)\//iu,
  /\bfile:\/\//iu,
  /%(?:localappdata|userprofile|appdata|temp)%/iu,
  /(?:^|[\\/])\.\.(?:[\\/]|$)/u,
];

function isSafeProjectionText(text: string): boolean {
  return (
    detectSensitiveConversationContent(text).decision === "allow" &&
    !PATH_PATTERNS.some((pattern) => pattern.test(text))
  );
}
