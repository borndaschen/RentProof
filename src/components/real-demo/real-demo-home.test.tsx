import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(await screen.findByRole("heading", { name: "這間房子要叫什麼名稱？" })).toBeVisible();
    expect(screen.getByRole("link", { name: "登入保存紀錄" })).toHaveAttribute("href", "/auth");
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
    await user.type(await screen.findByLabelText("案件名稱"), "民生東路套房");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "繼續" }));
    expect(await screen.findByText("我要整理「民生東路套房」。")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1];
    expect(request?.[0]).toBe("/api/real-cases");
    expect(request?.[1]).toMatchObject({ method: "POST" });
    expect(String(request?.[1]?.body)).toContain('"cloudProcessingAcknowledged":true');
    expect((await axe(container)).violations).toHaveLength(0);
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
    await user.type(await screen.findByLabelText("案件名稱"), "測試案件");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "繼續" }));
    expect(await screen.findByRole("heading", { name: "請加入租屋廣告" })).toBeVisible();
    let fileInput = await screen.findByLabelText("選擇租屋廣告圖片");
    const uploadForm = fileInput.closest("form");
    if (!uploadForm) throw new Error("UPLOAD_FORM_MISSING");

    await user.upload(fileInput, new File(["png"], "listing.png", { type: "image/png" }));
    expect((fileInput as HTMLInputElement).files).toHaveLength(1);
    fireEvent.submit(uploadForm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await screen.findByText("租屋廣告已安全加入。");

    expect(await screen.findByRole("heading", { name: "接著加入看屋照片" })).toBeVisible();
    fileInput = await screen.findByLabelText("選擇看屋照片");
    await user.upload(fileInput, new File(["jpg"], "viewing.jpg", { type: "image/jpeg" }));
    const viewingForm = fileInput.closest("form");
    if (!viewingForm) throw new Error("VIEWING_FORM_MISSING");
    fireEvent.submit(viewingForm);
    await screen.findByText("看屋照片已安全加入。");

    expect(await screen.findByRole("heading", { name: "最後加入租約" })).toBeVisible();
    fileInput = await screen.findByLabelText("選擇租約PDF");
    await user.upload(fileInput, new File(["pdf"], "contract.pdf", { type: "application/pdf" }));
    const contractForm = fileInput.closest("form");
    if (!contractForm) throw new Error("CONTRACT_FORM_MISSING");
    fireEvent.submit(contractForm);
    await screen.findByText("租約已安全加入。");

    await user.click(await screen.findByRole("button", { name: "開始整理與比對" }));
    expect(await screen.findByRole("heading", { name: "這些是目前的比對結果" })).toBeVisible();
    expect(screen.getByText("確認洗衣機是否寫入附件。")).toBeVisible();
    expect(screen.getAllByText("1 項")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "刪除這個案件" }));
    expect(await screen.findByText("案件已刪除並停止存取。")).toBeVisible();
    expect(screen.getByRole("heading", { name: "這間房子要叫什麼名稱？" })).toBeVisible();
    expect((await axe(container)).violations).toHaveLength(0);
  });
});
