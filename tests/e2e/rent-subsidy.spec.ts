import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("runs the server-side subsidy precheck and remains accessible", async ({ page }) => {
  await page.goto("/rent-subsidy");
  await expect(page.getByRole("heading", { level: 1, name: "租屋補助申請條件預檢" })).toBeVisible();
  await page.getByLabel("租屋處縣市").selectOption("臺北市");

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/rent-subsidy/precheck"),
  );
  await page.getByRole("button", { name: "查看預檢結果" }).click();
  const response = await responsePromise;

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByRole("heading", { level: 2, name: "申請條件預檢結果" })).toBeVisible();
  await expect(page.getByText("資料不足", { exact: true }).first()).toBeVisible();
  await expect(
    page.locator("section").filter({ hasText: "申請條件預檢結果" }).getByRole("listitem"),
  ).toHaveCount(15);
  await expect(page.getByRole("link", { name: "前往政府官方申請專區" })).toHaveAttribute(
    "href",
    "https://pip.moi.gov.tw/v3/B/SCRB0102.aspx",
  );

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
