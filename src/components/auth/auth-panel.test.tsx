import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { AuthPanel } from "./auth-panel";

const mocks = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.routerReplace, refresh: mocks.routerRefresh }),
}));

const csrfToken = "a".repeat(43);
const mockedFetch = vi.fn<typeof fetch>();

function sessionResponse(status: "signed_out" | "authenticated" = "signed_out") {
  return new Response(
    JSON.stringify({
      schemaVersion: "rentproof.self-hosted-auth-session.v1",
      status,
      csrfToken,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("AuthPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockResolvedValue(sessionResponse());
    vi.stubGlobal("fetch", mockedFetch);
  });

  it("loads server session state and offers login, register, forgot password, and guest continuation", async () => {
    const user = userEvent.setup();
    const { container } = render(<AuthPanel />);
    expect(await screen.findByRole("heading", { name: "登入 RentProof" })).toBeVisible();
    expect(screen.getByRole("link", { name: "返回" })).toHaveAttribute("href", "/");
    expect(container).not.toHaveTextContent(/Demo|Fixture|Golden|P0|Synthetic|虛構/u);
    await user.click(screen.getByRole("button", { name: "註冊" }));
    expect(screen.getByRole("heading", { name: "建立帳戶" })).toBeVisible();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "忘記密碼" }));
    expect(screen.getByRole("heading", { name: "重設密碼" })).toBeVisible();
    expect((await axe(container)).violations).toHaveLength(0);
  });

  it("keeps the account controls reachable in keyboard order", async () => {
    const user = userEvent.setup();
    render(<AuthPanel />);
    await screen.findByRole("heading", { name: "登入 RentProof" });
    await user.tab();
    expect(screen.getByLabelText("Email")).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("密碼")).toHaveFocus();
    await user.tab();
    expect(screen.getAllByRole("button", { name: "登入" })[0]).toHaveFocus();
  });

  it("sends login only to the server and never stores a provider session in client state", async () => {
    mockedFetch
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "authenticated" }), { status: 200 }),
      );
    const user = userEvent.setup();
    render(<AuthPanel />);
    await screen.findByLabelText("Email");
    await user.type(screen.getByLabelText("Email"), "renter@example.test");
    await user.type(screen.getByLabelText("密碼"), "correct-password");
    await user.click(screen.getAllByRole("button", { name: "登入" })[0]!);
    await waitFor(() => expect(mocks.routerReplace).toHaveBeenCalledWith("/history"));
    const [, request] = mockedFetch.mock.calls[1]!;
    expect(mockedFetch.mock.calls[1]![0]).toBe("/api/auth/login");
    expect(request).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-rentproof-csrf": csrfToken,
      },
    });
    expect(String(request?.body)).toContain("correct-password");
    expect(sessionStorage).toHaveLength(0);
    expect(localStorage).toHaveLength(0);
  });

  it("requires an explicit policy acknowledgement for registration", async () => {
    mockedFetch
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    const user = userEvent.setup();
    render(<AuthPanel />);
    await screen.findByRole("heading", { name: "登入 RentProof" });
    await user.click(screen.getByRole("button", { name: "註冊" }));
    await user.type(screen.getByLabelText("Email"), "new@example.test");
    await user.type(screen.getByLabelText("密碼"), "new-password-12");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "建立帳戶" }));
    expect(await screen.findByText(/驗證碼已準備完成/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "驗證 Email" })).toBeVisible();
    expect(screen.getByRole("link", { name: "帳戶驗證中心" })).toHaveAttribute(
      "href",
      "/auth/dev-mailbox",
    );
    expect(String(mockedFetch.mock.calls[1]![1]?.body)).toContain('"demoPolicyAcknowledged":true');
  });

  it("renders policy consent destinations as keyboard-focusable links and keeps actions semantic", async () => {
    const user = userEvent.setup();
    render(<AuthPanel />);
    await screen.findByRole("heading", { name: "登入 RentProof" });
    expect(screen.getByRole("button", { name: "登入" })).toHaveClass("auth-primary-action");
    await user.click(screen.getByRole("button", { name: "註冊" }));

    const terms = screen.getByRole("link", { name: "使用條款草案" });
    const privacy = screen.getByRole("link", { name: "隱私政策草案" });
    const processing = screen.getByRole("link", { name: "資料處理方式" });
    expect(terms).toHaveAttribute("href", "/terms");
    expect(privacy).toHaveAttribute("href", "/privacy");
    expect(processing).toHaveAttribute("href", "/privacy#cloud-processing");
    for (const link of [terms, privacy, processing]) {
      expect(link.tagName).toBe("A");
      expect(link).toHaveClass("auth-inline-link");
      expect(link).not.toHaveAttribute("tabindex", "-1");
    }
    expect(screen.getByRole("button", { name: "建立帳戶" })).toHaveClass("auth-primary-action");
    expect(screen.getByRole("link", { name: "返回" })).toHaveClass("auth-option-link");
  });

  it("uses a generic reset-code flow without putting credentials in URLs or storage", async () => {
    mockedFetch
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    const user = userEvent.setup();
    render(<AuthPanel />);
    await screen.findByRole("heading", { name: "登入 RentProof" });
    await user.click(screen.getByRole("button", { name: "忘記密碼" }));
    await user.type(screen.getByLabelText("Email"), "nobody@example.invalid");
    await user.click(screen.getByRole("button", { name: "建立重設要求" }));
    expect(await screen.findByText(/若帳戶存在/u)).toBeVisible();
    expect(screen.getByLabelText("Email 驗證碼")).toBeVisible();
    const resetCode = "r".repeat(43);
    await user.type(screen.getByLabelText("Email 驗證碼"), resetCode);
    await user.type(screen.getByLabelText("新密碼"), "replacement-password");
    await user.click(screen.getByRole("button", { name: "設定新密碼並撤銷工作階段" }));
    expect(await screen.findByText(/若重設要求有效/u)).toBeVisible();
    expect(mockedFetch.mock.calls[1]![0]).toBe("/api/auth/password-reset/request");
    expect(mockedFetch.mock.calls[2]![0]).toBe("/api/auth/password-reset/complete");
    expect(String(mockedFetch.mock.calls[2]![0])).not.toMatch(/token|code|email/iu);
    expect(String(mockedFetch.mock.calls[2]![1]?.body)).toContain(`"code":"${resetCode}"`);
    expect(screen.getByLabelText("密碼")).toHaveValue("");
  });

  it("renders generic failures without exposing server details", async () => {
    mockedFetch
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(new Response("provider secret detail", { status: 503 }));
    const user = userEvent.setup();
    render(<AuthPanel />);
    await screen.findByLabelText("Email");
    await user.type(screen.getByLabelText("Email"), "account@example.test");
    await user.type(screen.getByLabelText("密碼"), "incorrect-password");
    await user.click(screen.getAllByRole("button", { name: "登入" })[0]!);
    expect(await screen.findByRole("status")).toHaveTextContent("系統不會透露帳戶是否存在");
    expect(screen.queryByText(/provider secret detail/iu)).not.toBeInTheDocument();
    expect(screen.getByLabelText("密碼")).toHaveValue("");
  });

  it("renders authenticated state from the server and logs out through a protected endpoint", async () => {
    mockedFetch
      .mockResolvedValueOnce(sessionResponse("authenticated"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const user = userEvent.setup();
    render(<AuthPanel />);
    expect(await screen.findByRole("heading", { name: "我的帳戶" })).toBeVisible();
    expect(screen.queryByLabelText("密碼")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "登出" }));
    expect(
      await screen.findByText("已安全登出。另一個有效要求才會再次建立工作階段。"),
    ).toBeVisible();
    expect(mockedFetch.mock.calls[1]![0]).toBe("/api/auth/logout");
    expect(mocks.routerRefresh).toHaveBeenCalledOnce();
  });

  it("fails closed when session response is malformed", async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "authenticated" }), { status: 200 }),
    );
    render(<AuthPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("帳戶服務目前無法使用");
    expect(screen.queryByLabelText("密碼")).not.toBeInTheDocument();
  });
});
