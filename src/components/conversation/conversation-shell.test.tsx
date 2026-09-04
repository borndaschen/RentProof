import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ConversationShell } from "./conversation-shell";

const assistantResponse = {
  schemaVersion: "rentproof.assistant-turn.v1",
  turnId: "turn_fixture_000000000001",
  caseRevision: 1,
  snapshotId: "snapshot_fixture_0000001",
  segments: [
    {
      kind: "server_message",
      templateKey: "next_step",
      text: "下一步請補拍設備位置。",
    },
  ],
  cards: [],
  remainingItemCount: 0,
  workspaceAction: null,
};

const runtimeStatus = {
  schemaVersion: "rentproof.runtime-status.v1" as const,
  llmMode: "fixture" as const,
  deploymentProfile: "local_development" as const,
  transport: "http" as const,
  dataPolicy: "synthetic_only" as const,
  projectLimits: "unverified" as const,
  authMode: "synthetic" as const,
  ruleProfile: "p0" as const,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConversationShell", () => {
  it("submits a free-text turn and renders only a schema-valid assistant response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(assistantResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ConversationShell runtimeStatus={runtimeStatus} />);

    const input = screen.getByRole("textbox", { name: "輸入你的問題" });
    await user.type(input, "下一步是什麼？");
    await user.click(screen.getByRole("button", { name: /送出/u }));

    expect(await screen.findByText("下一步請補拍設備位置。")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: "下一步是什麼？",
    });
  });

  it("keeps the draft and requires an explicit action for a PII warning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "PII_WARNING_REQUIRED" },
            acknowledgement: {
              acknowledgementId: "acknowledgement_fixture_000001",
              expiresAt: "2026-09-02T12:10:00.000Z",
              piiKinds: ["email"],
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<ConversationShell runtimeStatus={runtimeStatus} />);

    const input = screen.getByRole("textbox", { name: "輸入你的問題" });
    await user.type(input, "example@example.com");
    await user.click(screen.getByRole("button", { name: /送出/u }));

    expect(await screen.findByText("可能包含個人資料")).toBeVisible();
    expect(screen.getByText(/可能涉及：電子郵件/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "返回修改" })).toBeVisible();
    expect(screen.getByRole("button", { name: "我了解，仍要送出" })).toBeVisible();
    expect(input).toHaveValue("example@example.com");
  });

  it("reuses the same request id and adds the server-issued PII acknowledgement", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "PII_WARNING_REQUIRED" },
            acknowledgement: {
              acknowledgementId: "acknowledgement_fixture_000001",
              expiresAt: "2026-09-02T12:10:00.000Z",
              piiKinds: ["email"],
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(assistantResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ConversationShell runtimeStatus={runtimeStatus} />);

    await user.type(screen.getByRole("textbox", { name: "輸入你的問題" }), "example@example.com");
    await user.click(screen.getByRole("button", { name: "送出" }));
    await user.click(await screen.findByRole("button", { name: "我了解，仍要送出" }));

    expect(await screen.findByText("下一步請補拍設備位置。")).toBeVisible();
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(secondHeaders.get("Idempotency-Key")).toBe(firstHeaders.get("Idempotency-Key"));
    expect(secondHeaders.get("PII-Acknowledgement")).toBe("acknowledgement_fixture_000001");
  });

  it("fails closed for an invalid assistant payload and retains the draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "unvalidated text" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const user = userEvent.setup();
    render(<ConversationShell runtimeStatus={runtimeStatus} />);
    const input = screen.getByRole("textbox", { name: "輸入你的問題" });
    await user.type(input, "保留這段草稿");
    await user.click(screen.getByRole("button", { name: "送出" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "系統回覆格式有誤，沒有更新案件。請稍後再試。",
    );
    expect(input).toHaveValue("保留這段草稿");
  });

  it("keeps oversized text local and never calls the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ConversationShell runtimeStatus={runtimeStatus} />);
    const input = screen.getByRole("textbox", { name: "輸入你的問題" });
    fireEvent.change(input, { target: { value: "字".repeat(2_001) } });
    expect(screen.getByRole("button", { name: "送出" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("switches the four evidence workspace areas with keyboard-operable tabs", async () => {
    const user = userEvent.setup();
    render(<ConversationShell runtimeStatus={runtimeStatus} />);

    const summary = screen.getByRole("tab", { name: "摘要" });
    const evidence = screen.getByRole("tab", { name: "證據" });
    expect(summary).toHaveAttribute("aria-selected", "true");
    await user.click(evidence);
    expect(evidence).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "證據矩陣" })).toBeVisible();

    evidence.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "契約" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "報告" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "簽約前報告" })).toBeVisible();
    expect(screen.getByRole("link", { name: "開啟完整可列印報告" })).toHaveAttribute(
      "href",
      "/reports/golden-v1",
    );
  });

  it("requires a server-issued confirmation before applying a material candidate", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            confirmationId: "confirmation_fixture_000001",
            csrfToken: "csrf_confirmation_fixture_01",
            expiresAt: "2026-09-02T12:10:00.000Z",
            caseRevision: 0,
            candidate: {
              candidateType: "update_case_profile",
              changes: [
                {
                  field: "electricity_payer",
                  value: { status: "known", value: "tenant" },
                },
              ],
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, revision: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ConversationShell runtimeStatus={runtimeStatus} />);

    await user.click(screen.getByRole("button", { name: "檢查後加入" }));
    const confirm = await screen.findByRole("button", { name: "確認並加入案件" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("尚未加入案件")).toBeVisible();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/cases/golden-v1/confirmations");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateKey: "fixture_electricity_payer_tenant" }),
    });
    await user.click(confirm);
    expect(await screen.findByText("已確認並更新案件。")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/cases/golden-v1/confirmations/confirmation_fixture_000001",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "X-CSRF-Token": "csrf_confirmation_fixture_01" }),
      body: "{}",
    });
  });

  it("fails closed when issuing or consuming a confirmation fails", async () => {
    const user = userEvent.setup();
    const issueFailure = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "CONFIRMATION_UNAVAILABLE" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", issueFailure);
    const firstRender = render(<ConversationShell runtimeStatus={runtimeStatus} />);
    await user.click(screen.getByRole("button", { name: "檢查後加入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "確認卡目前無法建立；案件內容沒有變更。",
    );
    firstRender.unmount();

    const consumeFailure = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            confirmationId: "confirmation_fixture_000001",
            csrfToken: "csrf_confirmation_fixture_01",
            expiresAt: "2026-09-02T12:10:00.000Z",
            caseRevision: 0,
            candidate: {
              candidateType: "update_case_profile",
              changes: [
                { field: "electricity_payer", value: { status: "known", value: "tenant" } },
              ],
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "CONFIRMATION_STALE" } }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", consumeFailure);
    render(<ConversationShell runtimeStatus={runtimeStatus} />);
    await user.click(screen.getByRole("button", { name: "檢查後加入" }));
    await user.click(await screen.findByRole("button", { name: "確認並加入案件" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("確認失敗；案件內容沒有變更。");
    expect(screen.getByText("尚未加入案件")).toBeVisible();
  });

  it("uses semantic sections without presenting prohibited verdict labels", () => {
    const { container } = render(<ConversationShell runtimeStatus={runtimeStatus} />);
    expect(screen.getByRole("main")).toBeVisible();
    expect(screen.getByRole("region", { name: "晴光套房 302" })).toBeVisible();
    expect(screen.getByRole("complementary", { name: "案件證據工作區" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "政策草案" })).toBeVisible();
    expect(container.textContent).not.toMatch(
      /確定違法|確定合法|確定詐騙|就是詐騙|詐騙機率|安全分數/u,
    );
  });

  it("has no detectable component-level axe violations", async () => {
    const { container } = render(<ConversationShell runtimeStatus={runtimeStatus} />);
    const results = await axe(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it("shows Live mode and a semantic warning when Project limits are unverified", () => {
    render(
      <ConversationShell
        runtimeStatus={{ ...runtimeStatus, llmMode: "live", projectLimits: "unverified" }}
      />,
    );

    expect(screen.queryByText(/OpenAI Live・Golden v1.*P0 六條規則/u)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("雲端分析的費用保護尚未確認");
  });

  it("does not show a Project warning when limits are operator-confirmed", () => {
    render(
      <ConversationShell
        runtimeStatus={{ ...runtimeStatus, llmMode: "live", projectLimits: "confirmed" }}
      />,
    );

    expect(screen.queryByText(/雲端分析的費用保護尚未確認/u)).not.toBeInTheDocument();
  });
});
