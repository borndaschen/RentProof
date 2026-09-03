import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { ReactNode } from "react";
import { RealDemoHome } from "./real-demo-home";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

describe("RealDemoHome", () => {
  it("lets a signed-out visitor start with a guest session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ status: "signed_out", csrfToken: "c".repeat(43) })),
    );
    const { container } = render(<RealDemoHome />);
    expect(await screen.findByText(/先告訴我這間房子怎麼稱呼/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "登入" })).toHaveAttribute("href", "/auth");
    expect(screen.queryByText(/Demo|Fixture|Golden|P0|P1|Synthetic|虛構/u)).not.toBeInTheDocument();
    expect((await axe(container)).violations).toHaveLength(0);
  });

  it("creates a case only after explicit processing consent", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "authenticated", csrfToken: "c".repeat(43) }))
      .mockResolvedValueOnce(
        Response.json({ caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890" }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(<RealDemoHome />);
    await user.type(await screen.findByLabelText("輸入訊息"), "民生東路套房");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    expect(await screen.findByText("我要整理「民生東路套房」。")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1];
    expect(request?.[0]).toBe("/api/real-cases");
    expect(request?.[1]).toMatchObject({ method: "POST" });
    expect(String(request?.[1]?.body)).toContain('"cloudProcessingAcknowledged":true');
    expect((await axe(container)).violations).toHaveLength(0);
  });

  it("uses one free-text composer to create a guest case and keeps the login reminder visible", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "signed_out", csrfToken: "c".repeat(43) }))
      .mockResolvedValueOnce(Response.json({ status: "guest" }, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({ caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890" }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RealDemoHome />);
    await user.type(await screen.findByLabelText("輸入訊息"), "我的新套房");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    expect(await screen.findByText("我要整理「我的新套房」。")).toBeVisible();
    expect(screen.getByText(/訪客模式使用/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "登入後保存案件" })).toHaveAttribute("href", "/auth");
  });

  it("recognizes text before uploading when a message and attachment are submitted together", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/auth/session")
        return Response.json({ status: "authenticated", csrfToken: "c".repeat(43) });
      if (url === "/api/real-cases")
        return Response.json(
          { caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890" },
          { status: 201 },
        );
      if (url.endsWith("/conversation"))
        return Response.json({ intent: { kind: "note" }, reply: "已收到。" });
      if (url.endsWith("/uploads"))
        return Response.json(
          {
            artifactId: "artifact_abcdefghijklmnopqrstuvwxyz123456789012345678",
            kind: "listing_image",
            mime: "image/png",
          },
          { status: 201 },
        );
      return Response.json({}, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "12345678-1234-1234-1234-123456789012" });
    const user = userEvent.setup();
    render(<RealDemoHome />);
    await user.type(await screen.findByLabelText("輸入訊息"), "案件");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    const input = await screen.findByLabelText("加入附件");
    await user.upload(input, new File(["png"], "listing.png", { type: "image/png" }));
    await user.type(screen.getByLabelText("輸入訊息"), "這是廣告");
    await user.click(screen.getByRole("button", { name: "傳送" }));
    await screen.findByText("租屋廣告已安全加入。");
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.findIndex((url) => url.endsWith("/conversation"))).toBeLessThan(
      urls.findIndex((url) => url.endsWith("/uploads")),
    );
  });

  it("explicitly transfers a guest case after the same browser signs in", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "signed_out", csrfToken: "c".repeat(43) }))
      .mockResolvedValueOnce(Response.json({ status: "guest" }, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({ caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890" }, { status: 201 }),
      )
      .mockResolvedValueOnce(Response.json({ status: "authenticated", csrfToken: "n".repeat(43) }))
      .mockResolvedValueOnce(
        Response.json({
          schemaVersion: "rentproof.guest-case-transfer.v1",
          status: "transferred",
          caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RealDemoHome />);
    await user.type(await screen.findByLabelText("輸入訊息"), "訪客案件");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    await user.click(await screen.findByRole("button", { name: "已登入，保存此案件" }));
    expect(await screen.findByText(/案件已保存到你的帳戶/u)).toBeVisible();
    expect(fetchMock.mock.calls[4]?.[0]).toContain("/transfer");
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ confirmation: "SAVE_GUEST_CASE_TO_ACCOUNT" }),
    });
    expect(screen.getByRole("link", { name: "我的案件" })).toBeVisible();
  });

  it("uploads the required sources, shows analysis results, and deletes the case", async () => {
    let uploadNumber = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return Response.json({ status: "authenticated", csrfToken: "c".repeat(43) });
      }
      if (url === "/api/real-cases") {
        return Response.json(
          { caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890" },
          { status: 201 },
        );
      }
      if (url.endsWith("/conversation")) {
        const body = JSON.parse(String(init?.body)) as { text: string };
        return Response.json({
          intent: { kind: body.text.includes("分析") ? "start_analysis" : "note" },
          reply: "已理解你的訊息。",
        });
      }
      if (url.endsWith("/uploads")) {
        uploadNumber += 1;
        const headers = new Headers(init?.headers);
        return Response.json(
          {
            artifactId: `artifact_${String(uploadNumber).padStart(48, "0")}`,
            kind: headers.get("X-RentProof-Upload-Kind"),
            mime: headers.get("X-RentProof-Upload-Mime"),
          },
          { status: 201 },
        );
      }
      if (url.endsWith("/analysis")) {
        return Response.json(
          {
            findings: [
              { status: "supported" },
              { status: "contradicted" },
              { status: "insufficient_evidence" },
            ],
            nextActions: ["確認洗衣機是否寫入附件。"],
          },
          { status: 201 },
        );
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({}, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "12345678-1234-1234-1234-123456789012" });
    const user = userEvent.setup();
    const { container } = render(<RealDemoHome analysisEnabled />);
    await user.type(await screen.findByLabelText("輸入訊息"), "測試案件");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    expect(await screen.findByText(/上傳包含租金/u)).toBeVisible();
    let fileInput = await screen.findByLabelText("加入附件");

    await user.upload(fileInput, new File(["png"], "listing.png", { type: "image/png" }));
    await user.type(screen.getByLabelText("輸入訊息"), "這是廣告截圖，月租資訊在上方。 ");
    expect((fileInput as HTMLInputElement).files).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "傳送" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await screen.findByText("租屋廣告已安全加入。");

    expect(await screen.findByText(/選擇一張能看清楚屋況/u)).toBeVisible();
    fileInput = await screen.findByLabelText("加入附件");
    await user.upload(fileInput, new File(["jpg"], "viewing.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    await screen.findByText("看屋照片已安全加入。");

    expect(await screen.findByText(/文字清楚、未加密的PDF/u)).toBeVisible();
    fileInput = await screen.findByLabelText("加入附件");
    await user.upload(fileInput, new File(["pdf"], "contract.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    await screen.findByText("租約已安全加入。");

    await user.type(screen.getByLabelText("輸入訊息"), "開始分析");
    await user.click(screen.getByRole("button", { name: "傳送" }));
    expect(await screen.findByRole("heading", { name: "這些是目前的比對結果" })).toBeVisible();
    expect(screen.getByText("確認洗衣機是否寫入附件。")).toBeVisible();
    expect(screen.getAllByText("1 項")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "刪除這個案件" }));
    expect(await screen.findByText("案件已刪除並停止存取。")).toBeVisible();
    expect(screen.getByText(/先告訴我這間房子怎麼稱呼/u)).toBeVisible();
    expect((await axe(container)).violations).toHaveLength(0);
  });
});
