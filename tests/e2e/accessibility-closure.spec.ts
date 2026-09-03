import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

test("workspace remains keyboard operable and preserves visible focus", async ({ page }) => {
  await page.goto("/");
  const evidenceTab = page.getByRole("tab", { name: "證據" });
  await evidenceTab.focus();
  await expect(evidenceTab).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "契約" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const reportTab = page.getByRole("tab", { name: "報告" });
  await expect(reportTab).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "開啟完整可列印報告" })).toBeVisible();

  const focusOutline = await reportTab.evaluate(
    (element) => getComputedStyle(element).outlineStyle,
  );
  expect(focusOutline).not.toBe("none");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("application and report reflow at an emulated 200 percent zoom", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "晴光套房 302" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/reports/golden-v1");
  await expect(page.getByRole("heading", { level: 1, name: "簽約前確認報告" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(
    page.getByRole("heading", { level: 2, name: "專有部分非自然死亡揭露" }),
  ).toBeVisible();
  await expect(page.getByText("尚無可採用的明確勾選", { exact: true })).toHaveCount(2);
});

test("print presentation retains evidence sections and removes interactive controls", async ({
  page,
}) => {
  await page.goto("/reports/golden-v1");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "列印或另存 PDF" })).toBeHidden();
  await expect(page.getByRole("table", { name: "本次官方規則檢查" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "專有部分非自然死亡揭露" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /項優先確認行動/u })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
