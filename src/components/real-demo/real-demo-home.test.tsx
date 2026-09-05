import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { ReactNode } from "react";
import { RealDemoHome } from "./real-demo-home";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    target,
    rel,
    className,
  }: {
    href: string;
    children: ReactNode;
    target?: string;
    rel?: string;
    className?: string;
  }) => (
    <a href={href} target={target} rel={rel} className={className}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RealDemoHome", () => {
  it("aborts an in-flight session request when the page unmounts", () => {
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<RealDemoHome />);
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("aborts an in-flight case mutation when the page unmounts", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "authenticated", csrfToken: "c".repeat(43) }))
      .mockImplementationOnce(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { unmount } = render(<RealDemoHome />);
    await user.type(await screen.findByLabelText("輸入訊息"), "未完成案件");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const signal = fetchMock.mock.calls[1]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("lets a signed-out visitor start with a guest session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ status: "signed_out", csrfToken: "c".repeat(43) })),
    );
    const { container } = render(<RealDemoHome />);
    expect(await screen.findByText(/先告訴我這間房子怎麼稱呼/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "租屋補助預檢" })).toHaveAttribute(
      "href",
      "/rent-subsidy",
    );
    expect(screen.queryByRole("link", { name: "開始租屋補助預檢" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登入" })).toHaveAttribute("href", "/auth");
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
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
    expect(screen.queryByText(/目前以訪客模式使用/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登出" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "帳戶" })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".header-nav-button")).toHaveLength(3);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    expect(await screen.findByText("我要整理「民生東路套房」。")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1];
    expect(request?.[0]).toBe("/api/real-cases");
    expect(request?.[1]).toMatchObject({ method: "POST", signal: expect.any(AbortSignal) });
    expect(String(request?.[1]?.body)).toContain('"cloudProcessingAcknowledged":true');
    expect((await axe(container)).violations).toHaveLength(0);
  });

  it("logs out through the server and clears the account projection before entering guest mode", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "authenticated", csrfToken: "c".repeat(43) }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ status: "guest" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RealDemoHome />);
    await user.click(await screen.findByRole("button", { name: "登出" }));
    expect(await screen.findByText(/目前以訪客模式使用/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "登入" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "登出" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/auth/logout");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: "{}" });
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
    expect(await screen.findByText(/訪客模式使用/u)).toBeVisible();
    expect(screen.getAllByText("RentProof")).toHaveLength(1);
    await user.type(await screen.findByLabelText("輸入訊息"), "我的新套房");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    expect(await screen.findByText("我要整理「我的新套房」。")).toBeVisible();
    expect(screen.getByText(/訪客模式使用/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "在新分頁登入後保存" })).toHaveAttribute(
      "href",
      "/auth",
    );
    expect(screen.getByRole("link", { name: "在新分頁登入後保存" })).toHaveAttribute(
      "target",
      "_blank",
    );
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

  it("accepts a desktop file drop on the fixed composer", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "authenticated", csrfToken: "c".repeat(43) }))
      .mockResolvedValueOnce(
        Response.json({ caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890" }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(<RealDemoHome />);
    await user.type(await screen.findByLabelText("輸入訊息"), "拖曳測試");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    const composer = container.querySelector("form.real-composer");
    if (!(composer instanceof HTMLFormElement)) throw new Error("COMPOSER_NOT_FOUND");
    fireEvent.drop(composer, {
      dataTransfer: { files: [new File(["png"], "listing.png", { type: "image/png" })] },
    });
    expect(screen.getByPlaceholderText("已選擇 listing.png")).toBeVisible();
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
    await user.click(await screen.findByRole("button", { name: "保存" }));
    expect(await screen.findByText(/案件已保存到你的帳戶/u)).toBeVisible();
    expect(fetchMock.mock.calls[4]?.[0]).toContain("/transfer");
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ confirmation: "SAVE_GUEST_CASE_TO_ACCOUNT" }),
    });
    expect(screen.getByRole("link", { name: "我的案件" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });

  it("keeps deletion available after saving a guest case fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "signed_out", csrfToken: "c".repeat(43) }))
      .mockResolvedValueOnce(Response.json({ status: "guest" }, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({ caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890" }, { status: 201 }),
      )
      .mockResolvedValueOnce(Response.json({ status: "authenticated", csrfToken: "n".repeat(43) }))
      .mockResolvedValueOnce(Response.json({ error: { code: "TRANSFER_FAILED" } }, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RealDemoHome />);
    await user.type(await screen.findByLabelText("輸入訊息"), "可刪除案件");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    await user.click(await screen.findByRole("button", { name: "保存" }));
    expect(await screen.findByText(/尚未完成保存/u)).toBeVisible();
    const deleteButton = screen.getByRole("button", { name: "刪除" });
    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);
    expect(await screen.findByText("案件已刪除並停止存取。")).toBeVisible();
    expect(fetchMock.mock.calls[5]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it.each(["complete", "timeout"] as const)(
    "keeps whole-case analysis pending beyond 60 seconds and handles %s within its bound",
    async (outcome) => {
      let resolveAnalysis: (response: Response) => void = () => {
        throw new Error("ANALYSIS_NOT_STARTED");
      };
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url === "/api/auth/session")
          return Response.json({ status: "authenticated", csrfToken: "c".repeat(43) });
        if (url === "/api/real-cases")
          return Response.json(
            { caseId: "case_abcdefghijklmnopqrstuvwxyz1234567890" },
            { status: 201 },
          );
        if (url.endsWith("/uploads")) {
          const headers = new Headers(init?.headers);
          return Response.json(
            {
              artifactId: `artifact_${headers.get("X-RentProof-Upload-Kind")}`,
              kind: headers.get("X-RentProof-Upload-Kind"),
              mime: headers.get("X-RentProof-Upload-Mime"),
            },
            { status: 201 },
          );
        }
        if (url.endsWith("/conversation"))
          return Response.json({ intent: { kind: "start_analysis" }, reply: "已理解你的訊息。" });
        if (url.endsWith("/analysis"))
          return new Promise<Response>((resolve, reject) => {
            resolveAnalysis = resolve;
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        return Response.json({}, { status: 500 });
      });
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();
      render(<RealDemoHome analysisEnabled />);
      await user.type(await screen.findByLabelText("輸入訊息"), "測試案件");
      await user.click(screen.getByRole("checkbox"));
      await user.click(screen.getByRole("button", { name: "傳送" }));
      await screen.findByText("案件已建立，可以開始加入資料。");
      for (const [name, type, message] of [
        ["listing.png", "image/png", "租屋廣告已安全加入。"],
        ["viewing.jpg", "image/jpeg", "看屋照片已安全加入。"],
        ["contract.pdf", "application/pdf", "租約已安全加入。"],
      ] as const) {
        await user.upload(screen.getByLabelText("加入附件"), new File(["test"], name, { type }));
        await user.click(screen.getByRole("button", { name: "傳送" }));
        await screen.findByText(message);
      }
      await user.type(screen.getByLabelText("輸入訊息"), "開始分析");
      vi.useFakeTimers();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "傳送" }));
      });
      const signal = fetchMock.mock.calls.find(([input]) =>
        String(input).endsWith("/analysis"),
      )?.[1]?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });
      expect(signal?.aborted).toBe(false);
      expect(screen.getByText("正在整理資料…")).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: "這些是目前的比對結果" }),
      ).not.toBeInTheDocument();
      if (outcome === "complete") {
        await act(async () => {
          resolveAnalysis(
            Response.json(
              {
                findings: [{ status: "insufficient_evidence" }],
                nextActions: ["請補拍洗衣機。"],
              },
              { status: 201 },
            ),
          );
        });
        expect(screen.getByRole("heading", { name: "這些是目前的比對結果" })).toBeVisible();
        expect(screen.getByText("請補拍洗衣機。")).toBeVisible();
      } else {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(90_000);
        });
        expect(signal?.aborted).toBe(true);
        expect(
          screen.getByText("目前無法完成整理；已加入的資料不會被標示為分析成功。"),
        ).toBeVisible();
        expect(
          screen.queryByRole("heading", { name: "這些是目前的比對結果" }),
        ).not.toBeInTheDocument();
      }
    },
  );

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

    expect(await screen.findByText(/30秒內的MP4看屋影片/u)).toBeVisible();
    fileInput = await screen.findByLabelText("加入附件");
    await user.upload(fileInput, new File(["mp4"], "viewing.mp4", { type: "video/mp4" }));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    await screen.findByText("看屋影片已安全加入。");

    expect(await screen.findByText(/文字清楚、未加密的 PDF/u)).toBeVisible();
    fileInput = await screen.findByLabelText("加入附件");
    await user.upload(fileInput, new File(["pdf"], "contract.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "傳送" }));
    await screen.findByText("租約已安全加入。");

    await user.type(screen.getByLabelText("輸入訊息"), "開始分析");
    await user.click(screen.getByRole("button", { name: "傳送" }));
    expect(await screen.findByRole("heading", { name: "這些是目前的比對結果" })).toBeVisible();
    expect(screen.getByText("確認洗衣機是否寫入附件。")).toBeVisible();
    expect(screen.getAllByText("1 項")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "刪除" }));
    expect(await screen.findByText("案件已刪除並停止存取。")).toBeVisible();
    expect(screen.getByText(/先告訴我這間房子怎麼稱呼/u)).toBeVisible();
    expect((await axe(container)).violations).toHaveLength(0);
  });
});
