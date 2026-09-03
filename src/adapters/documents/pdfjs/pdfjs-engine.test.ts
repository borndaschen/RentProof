import { describe, expect, it } from "vitest";
import {
  createPdfJsEngine,
  type PdfJsDocumentLike,
  type PdfJsLoader,
  type PdfJsOpenParameters,
  type PdfJsPageLike,
} from "./pdfjs-engine";

interface EngineState {
  parameters?: PdfJsOpenParameters;
  pageCleanup: number;
  documentCleanup: number;
  destroy: number;
}

function makeLoader(
  options: {
    page?: Partial<PdfJsPageLike>;
    document?: Partial<PdfJsDocumentLike>;
    loadErrorName?: string;
  } = {},
): { loader: PdfJsLoader; state: EngineState } {
  const state: EngineState = { pageCleanup: 0, documentCleanup: 0, destroy: 0 };
  const page: PdfJsPageLike = {
    getTextContent: async () => ({
      items: [{ str: "first" }, { type: "beginMarkedContent" }, { str: "second" }],
    }),
    getAnnotations: async () => [],
    getJSActions: async () => null,
    cleanup: () => {
      state.pageCleanup += 1;
    },
    ...options.page,
  };
  const document: PdfJsDocumentLike = {
    numPages: 1,
    isPureXfa: false,
    getAttachments: async () => null,
    getJSActions: async () => null,
    getFieldObjects: async () => null,
    getOpenAction: async () => null,
    getOutline: async () => [],
    getPage: async () => page,
    cleanup: async () => {
      state.documentCleanup += 1;
    },
    ...options.document,
  };
  const loader: PdfJsLoader = (parameters) => {
    state.parameters = parameters;
    let promise: Promise<PdfJsDocumentLike>;
    if (options.loadErrorName === undefined) {
      promise = Promise.resolve(document);
    } else {
      const error = new Error(options.loadErrorName);
      error.name = options.loadErrorName;
      promise = Promise.reject(error);
    }
    return {
      promise,
      destroy: async () => {
        state.destroy += 1;
      },
    };
  };
  return { loader, state };
}

describe("createPdfJsEngine", () => {
  it("passes local bytes with fail-closed PDF.js options and wraps text pages", async () => {
    const { loader, state } = makeLoader();
    const source = new Uint8Array([1, 2, 3]);
    const session = createPdfJsEngine(loader).open(source);
    const document = await session.ready;
    const page = await document.getPage(1);

    expect(state.parameters).toMatchObject({
      stopAtErrors: true,
      enableXfa: false,
      useSystemFonts: true,
      useWorkerFetch: false,
      disableAutoFetch: true,
      disableStream: true,
    });
    expect(state.parameters?.data).not.toBe(source);
    expect(state.parameters?.data).toEqual(source);
    expect(await page.getTextItems()).toEqual(["first", "second"]);
    await page.cleanup();
    await document.cleanup();
    await session.destroy();
    expect(state).toMatchObject({ pageCleanup: 1, documentCleanup: 1, destroy: 1 });
  });

  it("detects document attachments, scripts/actions, forms, and nested outline links", async () => {
    const nonEmpty = new Map([["key", "value"]]);
    const { loader } = makeLoader({
      document: {
        isPureXfa: true,
        getAttachments: async () => nonEmpty,
        getJSActions: async () => nonEmpty,
        getFieldObjects: async () => nonEmpty,
        getOpenAction: async () => nonEmpty,
        getOutline: async () => [
          { title: "parent", items: [{ title: "child", unsafeUrl: "https://example.test" }] },
        ],
      },
    });
    const inspection = await (
      await createPdfJsEngine(loader).open(new Uint8Array()).ready
    ).inspectActiveContent();
    expect(inspection).toEqual({
      hasJavaScriptOrAction: true,
      hasAttachments: true,
      hasForms: true,
      hasExternalLinks: true,
    });
  });

  it("detects page actions, attachments, forms, and external URLs", async () => {
    const nonEmpty = new Map([["action", "script"]]);
    const { loader } = makeLoader({
      page: {
        getJSActions: async () => nonEmpty,
        getAnnotations: async () => [
          { action: "Print" },
          { subtype: "FileAttachment" },
          { subtype: "Widget" },
          { url: "https://example.test" },
          "untrusted-non-object",
        ],
      },
    });
    const document = await createPdfJsEngine(loader).open(new Uint8Array()).ready;
    const inspection = await (await document.getPage(1)).inspectActiveContent();
    expect(inspection).toEqual({
      hasJavaScriptOrAction: true,
      hasAttachments: true,
      hasForms: true,
      hasExternalLinks: true,
    });
  });

  it.each([
    ["PasswordException", "encrypted"],
    ["InvalidPDFException", "damaged"],
    ["MissingPDFException", "damaged"],
    ["UnexpectedResponseException", "damaged"],
    ["UnknownFailure", "parse_failed"],
  ] as const)("maps PDF.js %s to %s", async (name, code) => {
    const { loader } = makeLoader({ loadErrorName: name });
    await expect(createPdfJsEngine(loader).open(new Uint8Array()).ready).rejects.toMatchObject({
      code,
    });
  });
});
