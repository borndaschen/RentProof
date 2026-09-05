import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { ProcessingCard } from "./processing-card";

const receipt = {
  artifactId: "artifact_000000000000001",
  kind: "contract_pdf",
  mime: "application/pdf",
} as const;
const caseId = "case_000000000000000001";
const status = {
  ...receipt,
  state: "requires_confirmation",
  confirmationId: "confirmation_00000000001",
  pages: [{ page: 1, text: "租金 12000 元" }],
  reasonCode: null,
};
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("OCR confirmation and processing card", () => {
  it("requires checking the original before enabling confirmation and renders accessible text", async () => {
    const user = userEvent.setup();
    const finished = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ ...receipt, state: "available", reasonCode: null }));
    vi.stubGlobal("fetch", fetch);
    const { container } = render(
      <ProcessingCard caseId={caseId} receipt={receipt} csrfToken="csrf" onFinished={finished} />,
    );
    const button = await screen.findByRole("button", { name: "確認文字並加入租約" });
    expect(button).toBeDisabled();
    expect(finished).not.toHaveBeenCalled();
    await user.click(screen.getByText("第 1 頁辨識文字"));
    expect(screen.getByText("租金 12000 元")).toBeVisible();
    expect((await axe(container)).violations).toEqual([]);
    await user.click(screen.getByRole("checkbox"));
    await user.click(button);
    await waitFor(() => expect(finished).toHaveBeenCalledWith(receipt));
    const post = fetch.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(JSON.parse(String((post?.[1] as RequestInit | undefined)?.body))).toEqual({
      confirmationId: status.confirmationId,
      explicitlyConfirmed: true,
    });
  });
  it("escapes document markup and does not send edited pages to the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ...status,
          pages: [{ page: 1, text: "<script>document.body.remove()</script>" }],
        }),
      ),
    );
    const { container } = render(
      <ProcessingCard caseId={caseId} receipt={receipt} csrfToken="csrf" onFinished={vi.fn()} />,
    );
    await screen.findByText("<script>document.body.remove()</script>");
    expect(container.querySelector("script")).toBeNull();
  });
  it("rejects cross-artifact responses without showing the candidate", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ ...status, artifactId: "artifact_other_000000001" })),
    );
    render(
      <ProcessingCard caseId={caseId} receipt={receipt} csrfToken="csrf" onFinished={vi.fn()} />,
    );
    await screen.findByRole("alert");
    expect(screen.queryByText("租金 12000 元")).not.toBeInTheDocument();
  });
  it("aborts polling on unmount and offers cancellation without treating it as success", async () => {
    const finished = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...receipt, state: "queued" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(
      <ProcessingCard caseId={caseId} receipt={receipt} csrfToken="csrf" onFinished={finished} />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "取消這份檔案" }));
    await waitFor(() => expect(finished).toHaveBeenCalledWith(null));
    const init = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    unmount();
    expect(init?.signal?.aborted).toBe(true);
  });
});
