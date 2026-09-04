import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("serves only sealed browser-visible Golden artifacts", async ({ request }) => {
  const listing = await request.get("/api/demo/golden-v1/artifacts/listing-synthetic-listing-png");
  expect(listing.status()).toBe(200);
  expect(listing.headers()["content-type"]).toBe("image/png");
  expect(listing.headers()["cache-control"]).toContain("no-store");
  expect((await listing.body()).byteLength).toBeGreaterThan(10_000);

  const contract = await request.get("/api/demo/golden-v1/artifacts/contract-synthetic-lease-pdf");
  expect(contract.status()).toBe(200);
  expect(contract.headers()["content-type"]).toBe("application/pdf");

  const hiddenTruth = await request.get("/api/demo/golden-v1/artifacts/truth-assertions-json");
  expect(hiddenTruth.status()).toBe(404);
});

test("policy drafts are accessible and never presented as effective", async ({ page }) => {
  for (const [path, title] of [
    ["/privacy", "隱私政策草案"],
    ["/terms", "使用條款草案"],
    ["/cookies", "Cookie 政策草案"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("DRAFT・尚未生效")).toBeVisible();
    await expect(page.getByText(/不代表已完成台灣法務或隱私審閱/u)).toBeVisible();
  }
  await page.getByRole("link", { name: "返回 RentProof" }).click();
  await expect(page.getByRole("link", { name: "使用條款" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cookie 政策" })).toBeVisible();
});

test("material candidate changes only after a one-time server confirmation", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "single deterministic case mutation");
  await page.goto("/");
  await page.getByRole("button", { name: "檢查後加入" }).click();
  const confirm = page.getByRole("button", { name: "確認並加入案件" });
  await expect(confirm).toBeVisible();
  const consumeRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/api\/cases\/golden-v1\/confirmations\/[^/]+$/u.test(request.url()),
  );
  await confirm.click();
  const consumeRequest = await consumeRequestPromise;
  expect(consumeRequest.headers()["x-csrf-token"]).toBeTruthy();
  await expect(page.getByText("已確認並更新案件。")).toBeVisible();
  await expect(confirm).toBeHidden();
});

test("sealed uploads create a Fixture snapshot and open the report", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "single in-memory Golden upload run");
  await page.goto("/");
  const panel = page.getByRole("region", { name: "載入已封存的虛構證據" });
  for (const label of ["虛構租屋廣告 PNG", "虛構看屋照片 JPG", "虛構租約 PDF"]) {
    const item = panel.getByRole("listitem").filter({ hasText: label });
    await item.getByRole("button", { name: "載入此虛構素材" }).click();
    await expect(item.getByRole("button", { name: "已安全載入" })).toBeDisabled();
  }
  const analyze = panel.getByRole("button", { name: "分析已載入素材" });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  await expect(panel.getByRole("region", { name: "範例分析結果" })).toContainText(
    "洗衣機承諾：證據不足",
  );
  await panel.getByRole("link", { name: "查看完整簽約前報告" }).click();
  await expect(page).toHaveURL(/\/reports\/golden-v1$/u);
  await expect(page.getByRole("heading", { level: 1, name: "簽約前確認報告" })).toBeVisible();
});

test("mocked sealed follow-up closes only the wall evidence dependency", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "single deterministic follow-up flow");
  const imageReceipt = (artifactId: string) => ({
    schemaVersion: "rentproof.synthetic-upload-receipt.v1",
    receiptId: `receipt_${artifactId.replaceAll("-", "_")}`.slice(0, 128),
    kind: artifactId.startsWith("listing-")
      ? "listing"
      : artifactId.startsWith("viewing-")
        ? "viewing"
        : "follow_up",
    originalSha256: "a".repeat(64),
    derivativeSha256: "b".repeat(64),
    media: {
      type: "image",
      mime: artifactId.endsWith("jpg") ? "image/jpeg" : "image/png",
      width: 640,
      height: 480,
    },
  });
  await page.route("**/api/demo/golden-v1/artifacts/**", async (route) => {
    const artifactId = route.request().url().split("/").at(-1) ?? "";
    const pdf = artifactId.endsWith("pdf");
    await route.fulfill({
      status: 200,
      contentType: pdf
        ? "application/pdf"
        : artifactId.endsWith("jpg")
          ? "image/jpeg"
          : "image/png",
      body: pdf ? "%PDF-1.7 synthetic" : "synthetic image bytes",
    });
  });
  await page.route("**/api/cases/golden-v1/uploads", async (route) => {
    const artifactId = route.request().headers()["x-rentproof-demo-artifact-id"] ?? "";
    const payload = artifactId.endsWith("pdf")
      ? {
          schemaVersion: "rentproof.synthetic-upload-receipt.v1",
          receiptId: "receipt_contract_abcdefghij",
          kind: "contract",
          originalSha256: "c".repeat(64),
          derivativeSha256: null,
          media: {
            type: "pdf",
            mime: "application/pdf",
            pageCount: 3,
            characterCount: 1_234,
          },
        }
      : imageReceipt(artifactId);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
  await page.route("**/api/cases/golden-v1/analysis-runs", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
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
      }),
    });
  });
  await page.route("**/findings/finding_wall_follow_up_00001/follow-ups", async (route) => {
    const requestBody = route.request().postDataJSON() as unknown;
    expect(requestBody).toEqual({
      receiptId: "receipt_follow_up_wall_close_up_png",
      expectedRevision: 0,
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "rentproof.follow-up-result.v1",
        snapshotId: "snapshot_followup_abcdefghij",
        caseRevision: 1,
        executionMode: "fixture",
        changedDependencyIds: ["observation_wall_discoloration_01", "finding_wall_follow_up_00001"],
        unchangedFindings: [
          {
            claimId: "claim-washing-machine",
            status: "insufficient_evidence",
            sourceRefs: ["viewing:view-10"],
          },
        ],
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
      }),
    });
  });

  await page.goto("/");
  const panel = page.getByRole("region", { name: "載入已封存的虛構證據" });
  for (const label of ["虛構租屋廣告 PNG", "虛構看屋照片 JPG", "虛構租約 PDF"]) {
    await panel
      .getByRole("listitem")
      .filter({ hasText: label })
      .getByRole("button", { name: "載入此虛構素材" })
      .click();
  }
  await panel.getByRole("button", { name: "分析已載入素材" }).click();
  await panel
    .getByRole("listitem")
    .filter({ hasText: "虛構牆面補拍 PNG" })
    .getByRole("button", { name: "載入此虛構素材" })
    .click();
  await panel.getByRole("button", { name: "套用牆面補拍" }).click();
  const result = panel.getByRole("region", { name: "牆面補拍更新結果" });
  await expect(result).toContainText("牆面可見不明變色；僅記錄可觀察現象。");
  await expect(result).toContainText("向出租人詢問並索取可定位的修繕紀錄。");
  await expect(result).not.toContainText(/漏水|結構危險|責任歸屬/u);
  await expect(result.getByRole("link", { name: "補拍前現場證據" })).toBeVisible();
  await expect(result.getByRole("link", { name: "補拍後近照證據" })).toBeVisible();
});

test("workspace tabs expose the controlled printable report", async ({ page }) => {
  await page.goto("/");
  const evidenceTab = page.getByRole("tab", { name: "證據" });
  await evidenceTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "契約" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const reportTab = page.getByRole("tab", { name: "報告" });
  await expect(reportTab).toBeFocused();
  await page.keyboard.press("Enter");
  const reportLink = page.getByRole("link", { name: "開啟完整可列印報告" });
  await expect(reportLink).toHaveAttribute("href", "/reports/golden-v1");
  await reportLink.click();
  await expect(page.getByRole("heading", { level: 1, name: "簽約前確認報告" })).toBeVisible();
  await expect(page.getByText("這不是法律意見，也不是詐騙判決。")).toBeVisible();
});

test("conversation-first shell is readable and keyboard operable", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");

  await expect(page.getByRole("heading", { level: 1, name: "晴光套房 302" })).toBeVisible();
  await expect(page.getByText("沒有拍到不等於矛盾", { exact: false })).toBeVisible();
  await expect(page.getByText("Fixture・Golden v1", { exact: false })).toHaveCount(0);

  const composer = page.getByRole("textbox", { name: "輸入你的問題" });
  const send = page.getByRole("button", { name: "送出" });
  await expect(send).toBeDisabled();
  await composer.fill("為什麼這項是證據不足？");
  await expect(send).toBeEnabled();
  await expect(page.getByText(/^\d+ \/ 2,000$/u)).toBeVisible();
  await send.click();
  await expect(page.getByText("RentProof・範例說明")).toBeVisible();
  await expect(page.getByText("洗衣機承諾：證據不足")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
