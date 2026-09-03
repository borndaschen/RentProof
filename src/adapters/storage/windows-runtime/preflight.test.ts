import { describe, expect, it } from "vitest";
import { WindowsRuntimePolicyError } from "./errors";
import type { WindowsPathInspection, WindowsRuntimePlatformProbe } from "./platform-probe";
import { preflightWindowsRuntimePath, type WindowsRuntimePreflightInput } from "./preflight";

const input: WindowsRuntimePreflightInput = {
  localAppData: "C:\\Users\\Demo\\AppData\\Local",
  repositoryRoot: "C:\\Work\\RentProof",
  demoRoot: "C:\\Users\\Demo\\RentProof-Demo",
  publicRoot: "C:\\Work\\RentProof\\public",
  userProfile: "C:\\Users\\Demo",
};

function probeWith(override: Partial<WindowsPathInspection> = {}): WindowsRuntimePlatformProbe {
  return {
    inspectPath: async (path) => ({
      resolvedPath: path,
      volumeKind: "fixed",
      hasReparsePointInPath: false,
      ...override,
    }),
  };
}

async function expectCode(
  action: () => Promise<unknown>,
  code: WindowsRuntimePolicyError["code"],
): Promise<void> {
  await expect(action()).rejects.toMatchObject({ code });
}

describe("preflightWindowsRuntimePath", () => {
  it("returns a canonical fixed-volume default", async () => {
    await expect(preflightWindowsRuntimePath(input, probeWith())).resolves.toEqual({
      path: "C:\\Users\\Demo\\AppData\\Local\\RentProof\\runtime",
      source: "local_app_data_default",
    });
  });

  it("rejects removable, network, unknown, and reparse paths", async () => {
    for (const volumeKind of ["removable", "network", "unknown"] as const) {
      await expectCode(
        () => preflightWindowsRuntimePath(input, probeWith({ volumeKind })),
        "RUNTIME_VOLUME_NOT_FIXED",
      );
    }
    await expectCode(
      () => preflightWindowsRuntimePath(input, probeWith({ hasReparsePointInPath: true })),
      "RUNTIME_REPARSE_POINT_DISALLOWED",
    );
  });

  it("rechecks resolved paths against forbidden boundaries", async () => {
    await expectCode(
      () =>
        preflightWindowsRuntimePath(
          input,
          probeWith({ resolvedPath: "C:\\Work\\RentProof\\escaped-runtime" }),
        ),
      "RUNTIME_PATH_OVERLAP_DISALLOWED",
    );
  });
});
