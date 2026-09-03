import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { GoldenUploadPanel } from "./golden-upload-panel";

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1);
const PDF = new TextEncoder().encode("%PDF-1.7 fixture");

function imageReceipt(
  kind: "listing" | "viewing" | "follow_up" = "listing",
  mime: "image/jpeg" | "image/png" = "image/png",
) {
  return {
    schemaVersion: "rentproof.synthetic-upload-receipt.v1",
    receiptId: "receipt_abcdefghijklmnopqr",
    kind,
    originalSha256: "a".repeat(64),
    derivativeSha256: "b".repeat(64),
    media: { type: "image", mime, width: 640, height: 480 },
  };
}

function pdfReceipt() {
  return {
    schemaVersion: "rentproof.synthetic-upload-receipt.v1",
    receiptId: "receipt_pdf_abcdefghijklmn",
    kind: "contract",
    originalSha256: "c".repeat(64),
    derivativeSha256: null,
    media: { type: "pdf", mime: "application/pdf", pageCount: 3, characterCount: 1_234 },
  };
}

function binaryResponse(bytes: Uint8Array, mime: string): Response {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Response(copy.buffer, { status: 200, headers: { "Content-Type": mime } });
}

function jsonResponse(payload: unknown, status = 201): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function uploadButton(index: number): HTMLElement {
  const button = screen.getAllByRole("button", { name: "載入此虛構素材" }).at(index);
  if (button === undefined) throw new Error("UPLOAD_BUTTON_FIXTURE_MISSING");
  return button;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GoldenUploadPanel", () => {
  it("renders only four controlled Synthetic actions and no real-data input", () => {
    const { container } = render(<GoldenUploadPanel />);
    expect(screen.getAllByRole("button", { name: "載入此虛構素材" })).toHaveLength(4);
    expect(screen.getByText(/HTTP 開發模式只允許/u)).toBeVisible();
    expect(screen.getByText(/僅限 Synthetic 開發資料/u)).toBeVisible();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("[type='file']")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("[contenteditable='true']")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("performs controlled same-origin GET then binary POST with exact headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(binaryResponse(PNG, "image/png"))
      .mockResolvedValueOnce(jsonResponse(imageReceipt()));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<GoldenUploadPanel />);

    await user.click(uploadButton(0));
    expect(await screen.findByText("廣告・640 × 480 px")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/demo/golden-v1/artifacts/listing-synthetic-listing-png",
      { method: "GET", cache: "no-store", credentials: "same-origin" },
    ]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/cases/golden-v1/uploads");
    const request = fetchMock.mock.calls[1]?.[1];
    expect(request).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(request?.headers).toEqual({
      "Content-Type": "application/octet-stream",
      "X-RentProof-Demo-Artifact-Id": "listing-synthetic-listing-png",
      "X-RentProof-Upload-Filename": "synthetic-listing.png",
      "X-RentProof-Upload-Mime": "image/png",
      "Idempotency-Key": expect.stringMatching(/^[A-Fa-f0-9-]{20,128}$/u),
      "X-RentProof-CSRF": "rentproof-synthetic-upload-v1",
    });
    expect(ArrayBuffer.isView(request?.body)).toBe(true);
    expect(screen.getByRole("button", { name: "已安全載入" })).toBeDisabled();
  });

  it("validates and displays PDF page/character metadata without raw text or hashes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(binaryResponse(PDF, "application/pdf"))
        .mockResolvedValueOnce(jsonResponse(pdfReceipt())),
    );
    const user = userEvent.setup();
    render(<GoldenUploadPanel />);
    const contractButton = uploadButton(2);
    await user.click(contractButton);

    expect(await screen.findByText("契約・3 頁・1234 字元")).toBeVisible();
    expect(document.body.textContent).not.toContain("c".repeat(64));
    expect(document.body.textContent).not.toContain("%PDF");
  });

  it.each([
    [1, "image/jpeg", "viewing", "看屋證據・640 × 480 px"],
    [3, "image/png", "follow_up", "補拍證據・640 × 480 px"],
  ] as const)("renders the controlled image kind for item %i", async (index, mime, kind, label) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(binaryResponse(PNG, mime))
        .mockResolvedValueOnce(jsonResponse(imageReceipt(kind, mime))),
    );
    const user = userEvent.setup();
    render(<GoldenUploadPanel />);
    await user.click(uploadButton(index));
    expect(await screen.findByText(label)).toBeVisible();
  });

  it("fails safely when the sealed source GET is unavailable or has the wrong MIME", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(binaryResponse(PNG, "image/jpeg"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<GoldenUploadPanel />);

    await user.click(uploadButton(0));
    expect(await screen.findByRole("alert")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重新載入" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a schema-valid receipt whose kind does not match the controlled artifact", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(binaryResponse(PNG, "image/png"))
        .mockResolvedValueOnce(jsonResponse(imageReceipt("viewing"))),
    );
    const user = userEvent.setup();
    render(<GoldenUploadPanel />);
    await user.click(uploadButton(0));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(document.body.textContent).not.toContain("看屋證據・640");
  });

  it("shows a safe failure for server tamper rejection and allows retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(binaryResponse(PNG, "image/png"))
        .mockResolvedValueOnce(
          jsonResponse({ error: { code: "DEMO_ARTIFACT_TAMPERED", detail: "private path" } }, 400),
        ),
    );
    const user = userEvent.setup();
    render(<GoldenUploadPanel />);
    await user.click(uploadButton(0));

    expect(await screen.findByRole("alert")).toHaveTextContent("載入失敗；未建立任何素材收據。");
    expect(screen.getByRole("button", { name: "重新載入" })).toBeEnabled();
    expect(document.body.textContent).not.toContain("DEMO_ARTIFACT_TAMPERED");
    expect(document.body.textContent).not.toContain("private path");
  });

  it("rejects malformed success receipts without rendering path, text, or full hashes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(binaryResponse(PNG, "image/png"))
        .mockResolvedValueOnce(
          jsonResponse({
            ...imageReceipt(),
            rawText: "租約秘密",
            absolutePath: "C:\\private\\contract.pdf",
          }),
        ),
    );
    const user = userEvent.setup();
    render(<GoldenUploadPanel />);
    await user.click(uploadButton(0));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(document.body.textContent).not.toContain("租約秘密");
    expect(document.body.textContent).not.toContain("C:\\private");
  });

  it("prevents duplicate and parallel requests", async () => {
    let resolveGet: ((response: Response) => void) | undefined;
    const pendingGet = new Promise<Response>((resolve) => {
      resolveGet = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => pendingGet)
      .mockResolvedValueOnce(jsonResponse(imageReceipt()));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<GoldenUploadPanel />);

    const buttons = screen.getAllByRole("button", { name: "載入此虛構素材" });
    const firstButton = buttons.at(0);
    const secondButton = buttons.at(1);
    if (firstButton === undefined || secondButton === undefined) {
      throw new Error("UPLOAD_BUTTON_FIXTURE_MISSING");
    }
    await user.click(firstButton);
    expect(await screen.findByText("正在取得並驗證 sealed bytes。")).toBeVisible();
    expect(secondButton).toBeDisabled();
    await user.click(secondButton);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveGet?.(binaryResponse(PNG, "image/png"));
    expect(await screen.findByText("廣告・640 × 480 px")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "已安全載入" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("supports native keyboard activation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(binaryResponse(PNG, "image/png"))
      .mockResolvedValueOnce(jsonResponse(imageReceipt()));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<GoldenUploadPanel />);

    const first = uploadButton(0);
    first.focus();
    expect(first).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("廣告・640 × 480 px")).toBeVisible();
  });

  it("creates a fixture snapshot only after listing, viewing, and contract receipts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(binaryResponse(PNG, "image/png"))
      .mockResolvedValueOnce(
        jsonResponse({ ...imageReceipt("listing"), receiptId: "receipt_listing_abcdefghij" }),
      )
      .mockResolvedValueOnce(binaryResponse(PNG, "image/jpeg"))
      .mockResolvedValueOnce(
        jsonResponse({
          ...imageReceipt("viewing", "image/jpeg"),
          receiptId: "receipt_viewing_abcdefghij",
        }),
      )
      .mockResolvedValueOnce(binaryResponse(PDF, "application/pdf"))
      .mockResolvedValueOnce(jsonResponse(pdfReceipt()))
      .mockResolvedValueOnce(
        jsonResponse({
          schemaVersion: "rentproof.fixture-analysis-snapshot.v1",
          snapshotId: "snapshot_fixture_abcdefghij",
          caseVersion: "golden-v1",
          manifestHash: "d".repeat(64),
          executionMode: "fixture",
          providerCalled: false,
          findings: [
            {
              claimId: "claim-washing-machine",
              status: "insufficient_evidence",
              sourceRefs: ["viewing:view-10"],
            },
          ],
          nextActions: ["補入設備附件"],
          reportHref: "/reports/golden-v1",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<GoldenUploadPanel />);

    const analysisButton = screen.getByRole("button", { name: "分析已載入素材" });
    expect(analysisButton).toBeDisabled();
    for (const label of ["虛構租屋廣告 PNG", "虛構看屋照片 JPG", "虛構租約 PDF"]) {
      const item = screen.getByText(label).closest("li");
      if (!item) throw new Error("CONTROLLED_UPLOAD_ITEM_MISSING");
      await user.click(within(item).getByRole("button", { name: "載入此虛構素材" }));
      expect(await within(item).findByRole("button", { name: "已安全載入" })).toBeDisabled();
    }
    expect(analysisButton).toBeEnabled();
    await user.click(analysisButton);
    expect(await screen.findByText("claim-washing-machine：證據不足")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看完整簽約前報告" })).toHaveAttribute(
      "href",
      "/reports/golden-v1",
    );
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/cases/golden-v1/analysis-runs");
  });

  it("applies the sealed wall follow-up as a local dependency update with before and after links", async () => {
    const baseSnapshot = {
      schemaVersion: "rentproof.fixture-analysis-snapshot.v1",
      snapshotId: "snapshot_fixture_abcdefghij",
      caseVersion: "golden-v1",
      manifestHash: "d".repeat(64),
      executionMode: "fixture",
      providerCalled: false,
      findings: [
        {
          claimId: "claim-washing-machine",
          status: "insufficient_evidence",
          sourceRefs: ["viewing:view-10"],
        },
      ],
      nextActions: ["補拍牆面近照"],
      reportHref: "/reports/golden-v1",
    };
    const result = {
      schemaVersion: "rentproof.follow-up-result.v1",
      snapshotId: "snapshot_followup_abcdefghij",
      caseRevision: 1,
      executionMode: "fixture",
      changedDependencyIds: ["observation_wall_discoloration_01", "finding_wall_follow_up_00001"],
      unchangedFindings: baseSnapshot.findings,
      wallObservation: {
        observationId: "observation_wall_discoloration_01",
        description: "牆面可見不明變色；僅記錄可觀察現象。",
        locator: {
          type: "image",
          locatorId: "locator_followup_abcdefghij",
          artifactId: "follow-up-wall-close-up-png",
          bbox: [0, 0, 1, 1],
        },
      },
      wallFinding: {
        findingId: "finding_wall_follow_up_00001",
        status: "evidence_acquired",
        reasonCode: "WALL_DETAIL_IMAGE_ACQUIRED",
        sourceLocatorIds: ["locator_wall_before_00001", "locator_followup_abcdefghij"],
        actions: ["向出租人詢問並索取可定位的修繕紀錄。"],
      },
      sources: [
        {
          relation: "before",
          label: "補拍前現場證據",
          artifactId: "viewing-view-10-jpg",
          href: "/api/demo/golden-v1/artifacts/viewing-view-10-jpg",
        },
        {
          relation: "after",
          label: "補拍後近照證據",
          artifactId: "follow-up-wall-close-up-png",
          href: "/api/demo/golden-v1/artifacts/follow-up-wall-close-up-png",
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(binaryResponse(PNG, "image/png"))
      .mockResolvedValueOnce(
        jsonResponse({ ...imageReceipt("listing"), receiptId: "receipt_listing_abcdefghij" }),
      )
      .mockResolvedValueOnce(binaryResponse(PNG, "image/jpeg"))
      .mockResolvedValueOnce(
        jsonResponse({
          ...imageReceipt("viewing", "image/jpeg"),
          receiptId: "receipt_viewing_abcdefghij",
        }),
      )
      .mockResolvedValueOnce(binaryResponse(PDF, "application/pdf"))
      .mockResolvedValueOnce(jsonResponse(pdfReceipt()))
      .mockResolvedValueOnce(jsonResponse(baseSnapshot))
      .mockResolvedValueOnce(binaryResponse(PNG, "image/png"))
      .mockResolvedValueOnce(
        jsonResponse({
          ...imageReceipt("follow_up"),
          receiptId: "receipt_followup_abcdefghij",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(result));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<GoldenUploadPanel />);

    for (const label of ["虛構租屋廣告 PNG", "虛構看屋照片 JPG", "虛構租約 PDF"]) {
      const item = screen.getByText(label).closest("li");
      if (item === null) throw new Error("CONTROLLED_UPLOAD_ITEM_MISSING");
      await user.click(within(item).getByRole("button", { name: "載入此虛構素材" }));
    }
    await user.click(screen.getByRole("button", { name: "分析已載入素材" }));
    expect(await screen.findByText(/已建立 Fixture Snapshot/u)).toBeVisible();
    const followUpItem = screen.getByText("虛構牆面補拍 PNG").closest("li");
    if (followUpItem === null) throw new Error("FOLLOW_UP_ITEM_MISSING");
    await user.click(within(followUpItem).getByRole("button", { name: "載入此虛構素材" }));
    await user.click(await screen.findByRole("button", { name: "套用牆面補拍" }));

    const region = await screen.findByRole("region", { name: "牆面補拍更新結果" });
    expect(within(region).getByText("牆面可見不明變色；僅記錄可觀察現象。")).toBeVisible();
    expect(within(region).getByText("向出租人詢問並索取可定位的修繕紀錄。")).toBeVisible();
    expect(within(region).getByRole("link", { name: "補拍前現場證據" })).toHaveAttribute(
      "href",
      "/api/demo/golden-v1/artifacts/viewing-view-10-jpg",
    );
    expect(within(region).getByRole("link", { name: "補拍後近照證據" })).toHaveAttribute(
      "href",
      "/api/demo/golden-v1/artifacts/follow-up-wall-close-up-png",
    );
    expect(region.textContent).not.toMatch(/漏水|結構危險|責任歸屬/u);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.body).toBe(
      JSON.stringify({ receiptId: "receipt_followup_abcdefghij", expectedRevision: 0 }),
    );
  });

  it("has no detectable component-level axe violations", async () => {
    const { container } = render(<GoldenUploadPanel />);
    const results = await axe(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
