import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import CookiesPage from "@/app/cookies/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import { LegalPage } from "./legal-page";

describe("LegalPage", () => {
  it("uses semantic navigation, heading, and article landmarks", () => {
    render(
      <LegalPage title="測試政策草案">
        <h2>資料處理</h2>
        <p>測試內容</p>
      </LegalPage>,
    );

    expect(screen.getByRole("main")).toBeVisible();
    expect(screen.getByRole("link", { name: /返回 RentProof/u })).toHaveAttribute("href", "/");
    expect(screen.getByRole("heading", { level: 1, name: "測試政策草案" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "資料處理" })).toBeVisible();
    expect(document.querySelector("article.legal-content")).not.toBeNull();
  });

  it.each([
    [PrivacyPage, "隱私政策草案"],
    [TermsPage, "使用條款草案"],
    [CookiesPage, "Cookie 政策草案"],
  ] as const)("keeps %s visibly marked as DRAFT", (PolicyPage, title) => {
    render(<PolicyPage />);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expect(screen.getByText("DRAFT・尚未生效")).toBeVisible();
    expect(screen.getByText(/不代表已完成台灣法務或隱私審閱/u)).toBeVisible();
  });

  it("does not present prohibited verdict language as a policy result", () => {
    const { container } = render(<TermsPage />);
    expect(container.textContent).not.toMatch(
      /確定違法|確定合法|確定詐騙|就是詐騙|詐騙機率|安全分數/u,
    );
    expect(screen.getByText(/不是法律意見、詐騙判決/u)).toBeVisible();
  });

  it.each([PrivacyPage, TermsPage, CookiesPage])(
    "has no detectable axe violations on a policy page",
    async (PolicyPage) => {
      const { container } = render(<PolicyPage />);
      const results = await axe(container, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(results.violations).toEqual([]);
    },
  );
});
