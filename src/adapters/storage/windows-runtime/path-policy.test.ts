import { describe, expect, it } from "vitest";
import { WindowsRuntimePolicyError } from "./errors";
import {
  assertNoRuntimeBoundaryOverlap,
  pathsOverlap,
  resolveRuntimePath,
  type RuntimePathBoundaries,
} from "./path-policy";

const boundaries: RuntimePathBoundaries = {
  repositoryRoot: "C:\\Work\\RentProof",
  demoRoot: "C:\\Users\\Demo\\RentProof-Demo",
  publicRoot: "C:\\Work\\RentProof\\public",
  userProfile: "C:\\Users\\Demo",
  documentsRoots: ["D:\\Documents"],
  oneDriveRoots: ["D:\\OneDrive - Example"],
};

function expectCode(action: () => unknown, code: WindowsRuntimePolicyError["code"]): void {
  try {
    action();
    throw new Error("Expected policy error");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(WindowsRuntimePolicyError);
    expect((error as WindowsRuntimePolicyError).code).toBe(code);
  }
}

describe("resolveRuntimePath", () => {
  it("defaults to LOCALAPPDATA/RentProof/runtime", () => {
    expect(resolveRuntimePath({ localAppData: "C:\\Users\\Demo\\AppData\\Local" })).toBe(
      "C:\\Users\\Demo\\AppData\\Local\\RentProof\\runtime",
    );
  });

  it("uses an explicit absolute local path", () => {
    expect(
      resolveRuntimePath({
        explicitRuntimeDir: "D:\\RentProofData\\runtime",
        localAppData: "C:\\ignored",
      }),
    ).toBe("D:\\RentProofData\\runtime");
  });

  it("fails closed instead of using TEMP or cwd when LOCALAPPDATA is missing", () => {
    expectCode(() => resolveRuntimePath({}), "RUNTIME_LOCALAPPDATA_MISSING");
  });

  it.each([
    "relative\\runtime",
    "C:\\",
    "\\\\server\\share\\runtime",
    "\\\\?\\C:\\runtime",
    "C:\\safe\\..\\runtime",
    " C:\\runtime",
  ])("rejects invalid, root, UNC, device, or dot-segment path %s", (path) => {
    expect(() => resolveRuntimePath({ explicitRuntimeDir: path })).toThrow(
      WindowsRuntimePolicyError,
    );
  });
});

describe("runtime overlap policy", () => {
  it("uses case-insensitive, segment-aware overlap checks", () => {
    expect(pathsOverlap("C:\\Work\\RentProof", "c:\\work\\rentproof\\public")).toBe(true);
    expect(pathsOverlap("C:\\Work\\RentProof2", "C:\\Work\\RentProof")).toBe(false);
  });

  it.each([
    "C:\\Work\\RentProof\\runtime",
    "C:\\Work",
    "C:\\Users\\Demo\\RentProof-Demo\\runtime",
    "C:\\Users\\Demo\\Documents\\RentProof",
    "C:\\Users\\Demo\\OneDrive\\RentProof",
    "D:\\Documents\\RentProof",
    "D:\\OneDrive - Example\\RentProof",
  ])("rejects repository, demo, public, Documents, OneDrive, and containing roots: %s", (path) => {
    expectCode(
      () => assertNoRuntimeBoundaryOverlap(path, boundaries),
      "RUNTIME_PATH_OVERLAP_DISALLOWED",
    );
  });

  it("accepts an unrelated local path", () => {
    expect(() =>
      assertNoRuntimeBoundaryOverlap(
        "C:\\Users\\Demo\\AppData\\Local\\RentProof\\runtime",
        boundaries,
      ),
    ).not.toThrow();
  });
});
