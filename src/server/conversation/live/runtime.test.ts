import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AssistantCardSchema } from "@/domain/conversation";
import { executeLiveConversationTurn } from "./runtime";

describe("live conversation runtime", () => {
  it("fails closed without an API key before a provider call", async () => {
    await expect(
      executeLiveConversationTurn({
        apiKey: "",
        caseId: "demo_case_golden_v1_01",
        actorRef: "dev_actor_fixture_000001",
        normalizedTurn: "下一步",
      }),
    ).rejects.toMatchObject({ code: "CONVERSATION_PROVIDER_AUTH_FAILED" });
  });

  it("keeps csrfToken required and compatible with AssistantCardSchema", () => {
    const base = {
      cardType: "candidate_confirmation",
      cardId: "confirmation_card_runtime_01",
      focusRefId: null,
      snapshotId: null,
      priorityClass: "pending_confirmation",
      confirmationId: "confirmation_runtime_00001",
      csrfToken: "csrf_confirmation_runtime_01",
      candidate: {
        candidateType: "update_case_profile",
        changes: [
          {
            field: "electricity_payer",
            value: { status: "known", value: "tenant" },
          },
        ],
      },
      expiresAt: "2026-09-02T09:10:00.000Z",
      status: "pending",
      primaryAction: "confirm_and_add",
      canModify: true,
    };
    expect(AssistantCardSchema.safeParse(base).success).toBe(true);
    const withoutCsrf = Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== "csrfToken"),
    );
    expect(AssistantCardSchema.safeParse(withoutCsrf).success).toBe(false);
  });
});
