import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  evaluateSecurityInventory,
  extractModuleSpecifiers,
  normalizeInventoryPath,
  type SecurityInventoryEntry,
} from "./security-gate-core.mjs";

const execFileAsync = promisify(execFile);
const blankEnv = { path: ".env.example", content: "OPENAI_API_KEY=\n" };
const validLicense = await readFile(resolve(process.cwd(), "LICENSE"), "utf8");
const validNotice = await readFile(resolve(process.cwd(), "NOTICE"), "utf8");
const validPackage = JSON.stringify({ license: "Apache-2.0", private: true });
const validLicensePolicy = [
  { path: "LICENSE", content: validLicense },
  { path: "NOTICE", content: validNotice },
  { path: "package.json", content: validPackage },
] as const;

function evaluate(...entries: SecurityInventoryEntry[]) {
  return evaluateSecurityInventory([blankEnv, ...validLicensePolicy, ...entries]);
}

describe("security gate architecture rules", () => {
  it("accepts clean ports and active allowlisted adapter SDK imports", () => {
    expect(
      evaluate(
        { path: "src/domain/evidence.ts", content: 'import { z } from "zod";' },
        { path: "src/application/use-case.ts", content: 'import type { Claim } from "@/domain";' },
        { path: "src/adapters/openai/gateway.ts", content: 'import OpenAI from "openai";' },
        { path: "src/adapters/ingestion/sharp/image.ts", content: 'import sharp from "sharp";' },
        {
          path: "src/adapters/documents/pdfjs/parser.ts",
          content: 'import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";',
        },
      ),
    ).toEqual([]);
  });

  it.each([
    ["OpenAI", 'import OpenAI from "openai";'],
    ["Sharp", 'import sharp from "sharp";'],
    ["PDF.js", 'import "pdfjs-dist";'],
    ["Clerk", 'import { auth } from "@clerk/nextjs/server";'],
    ["filesystem", 'import { readFile } from "node:fs/promises";'],
    ["adapter", 'import { gateway } from "@/adapters/openai";'],
  ])("rejects %s imports from domain/application", (_label, content) => {
    expect(evaluate({ path: "src/application/unsafe.ts", content })).toContainEqual({
      path: "src/application/unsafe.ts",
      rule: "INNER_LAYER_IMPORT_BOUNDARY",
    });
  });

  it.each([
    ["OpenAI", "src/server/openai.ts", 'import OpenAI from "openai";'],
    ["Sharp", "src/server/image.ts", 'import sharp from "sharp";'],
    ["PDF.js", "src/server/pdf.ts", 'import "pdfjs-dist";'],
    ["Clerk", "src/server/auth.ts", 'import { auth } from "@clerk/nextjs/server";'],
  ])("rejects non-allowlisted %s SDK import", (_label, path, content) => {
    expect(evaluate({ path, content })).toContainEqual({
      path,
      rule: "SDK_IMPORT_NOT_ALLOWLISTED",
    });
  });

  it("rejects the abandoned Clerk SDK even from its former adapter location", () => {
    expect(
      evaluate({
        path: "src/adapters/auth/clerk/provider.ts",
        content: 'import { auth } from "@clerk/nextjs/server";',
      }),
    ).toContainEqual({
      path: "src/adapters/auth/clerk/provider.ts",
      rule: "SDK_IMPORT_NOT_ALLOWLISTED",
    });
  });

  it("rejects client secret names/material and NEXT_PUBLIC secrets", () => {
    const secret = `sk-${"a".repeat(24)}`;
    const violations = evaluate({
      path: "src/components/client.tsx",
      content: `'use client'; const name = "OPENAI_API_KEY"; const publicName = "NEXT_PUBLIC_API_KEY"; const value = "${secret}";`,
    });
    expect(violations.map((violation) => violation.rule)).toEqual(
      expect.arrayContaining([
        "CLIENT_SECRET_REFERENCE_FORBIDDEN",
        "NEXT_PUBLIC_SECRET_NAME_FORBIDDEN",
        "SECRET_MATERIAL_DETECTED",
      ]),
    );
  });

  it("rejects fixture UI/route static imports of live adapters", () => {
    expect(
      evaluate({
        path: "src/app/api/fixture/route.ts",
        content:
          'import { runLive } from "@/server/conversation/live/handler"; const mode="fixture";',
      }),
    ).toContainEqual({
      path: "src/app/api/fixture/route.ts",
      rule: "FIXTURE_STATIC_IMPORTS_LIVE_ADAPTER",
    });
  });

  it("allows startup-guard references and deferred live loading from a fixture route", () => {
    expect(
      evaluate(
        {
          path: "src/server/env.ts",
          content: 'if (process.env["NEXT_PUBLIC_OPENAI_API_KEY"]) throw new Error("forbidden");',
        },
        {
          path: "src/app/api/fixture/route.ts",
          content:
            'const mode="fixture"; const live = () => import("@/server/conversation/live/runtime");',
        },
      ),
    ).toEqual([]);
  });

  it.each([
    ["email", "const value = 'tenant@example.com';"],
    ["phone", "const value = '0912-345-678';"],
    ["Taiwan ID", "const value = 'A123456789';"],
    ["financial", "const value = '銀行帳號：1234 5678 9012';"],
    ["data URL", "const value = 'data:image/png;base64,AAAA';"],
    ["QR payload", "const value = 'QR碼：https://pay.example/123';"],
  ])("rejects high-confidence runtime %s payload", (_label, content) => {
    expect(evaluate({ path: "src/server/payload.ts", content })).toContainEqual({
      path: "src/server/payload.ts",
      rule: "HIGH_CONFIDENCE_PII_OR_PAYLOAD_DETECTED",
    });
  });

  it("allows synthetic security patterns in tests without allowing private key material in runtime", () => {
    const privateKey = "-----BEGIN PRIVATE KEY-----";
    expect(evaluate({ path: "src/server/security.test.ts", content: privateKey })).toEqual([]);
    const completePrivateKey = `${privateKey}\n${"A".repeat(64)}\n-----END PRIVATE KEY-----`;
    expect(evaluate({ path: "src/server/runtime.ts", content: completePrivateKey })).toContainEqual(
      {
        path: "src/server/runtime.ts",
        rule: "SECRET_MATERIAL_DETECTED",
      },
    );
  });

  it("requires blank secret fields in .env.example", () => {
    const secret = `sk-${"b".repeat(24)}`;
    expect(
      evaluateSecurityInventory([{ path: ".env.example", content: `OPENAI_API_KEY=${secret}\n` }]),
    ).toContainEqual({ path: ".env.example", rule: "ENV_EXAMPLE_SECRET_VALUE" });
    expect(
      evaluateSecurityInventory([], { requireEnvExample: true, requireLicensePolicy: false }),
    ).toEqual([{ path: ".env.example", rule: "ENV_EXAMPLE_MISSING" }]);
  });

  it("requires the canonical Apache-2.0 license, NOTICE, and package metadata", () => {
    expect(evaluate()).toEqual([]);

    const withoutLicense = evaluateSecurityInventory([
      blankEnv,
      validLicensePolicy[1],
      validLicensePolicy[2],
    ]);
    expect(withoutLicense).toContainEqual({
      path: "LICENSE",
      rule: "APACHE_LICENSE_MISSING_OR_UNREADABLE",
    });

    expect(
      evaluateSecurityInventory([
        blankEnv,
        {
          path: "LICENSE",
          content: validLicense.replace(
            "3. Grant of Patent License.",
            "3. Patent section removed.",
          ),
        },
        validLicensePolicy[1],
        validLicensePolicy[2],
      ]),
    ).toContainEqual({ path: "LICENSE", rule: "APACHE_LICENSE_INVALID" });

    expect(
      evaluateSecurityInventory([
        blankEnv,
        { path: "LICENSE", content: "MIT License\nPermission is hereby granted" },
        validLicensePolicy[1],
        validLicensePolicy[2],
      ]),
    ).toContainEqual({ path: "LICENSE", rule: "APACHE_LICENSE_INVALID" });

    expect(
      evaluateSecurityInventory([
        blankEnv,
        validLicensePolicy[0],
        validLicensePolicy[1],
        { path: "package.json", content: JSON.stringify({ license: "MIT", private: true }) },
      ]),
    ).toContainEqual({ path: "package.json", rule: "PACKAGE_LICENSE_METADATA_INVALID" });

    expect(
      evaluateSecurityInventory([blankEnv, validLicensePolicy[0], validLicensePolicy[2]]),
    ).toContainEqual({ path: "NOTICE", rule: "APACHE_NOTICE_MISSING_OR_UNREADABLE" });
  });

  it.each([
    ["package-lock.json", "PACKAGE_MANAGER_LOCKFILE_FORBIDDEN"],
    ["yarn.lock", "PACKAGE_MANAGER_LOCKFILE_FORBIDDEN"],
    ["bun.lockb", "PACKAGE_MANAGER_LOCKFILE_FORBIDDEN"],
    ["COPYING.md", "LICENSE_FILE_AMBIGUOUS"],
    ["legal/LICENSE.md", "LICENSE_FILE_AMBIGUOUS"],
    ["RentProof-Demo/cases/golden-v1/photo.jpg", "DEMO_ASSET_IN_REPOSITORY"],
    ["fixtures/contract.pdf", "DEMO_ASSET_IN_REPOSITORY"],
    ["public/demo.png", "DEMO_ASSET_IN_REPOSITORY"],
    [".next/server/chunks/app.js.map", "SERVER_SOURCE_MAP_FORBIDDEN"],
  ])("rejects path policy %s", (path, rule) => {
    expect(evaluate({ path, content: null })).toContainEqual({ path, rule });
  });

  it("allows governed official PDF snapshots and pnpm lock", () => {
    expect(
      evaluate(
        { path: "rules/snapshots/2026-09-01/source.pdf", content: null },
        { path: "pnpm-lock.yaml", content: "lockfileVersion: '9.0'" },
      ),
    ).toEqual([]);
  });

  it("normalizes Windows inventory paths and extracts static/dynamic/require imports", () => {
    expect(normalizeInventoryPath("C:\\repo\\src\\domain\\file.ts")).toBe(
      "repo/src/domain/file.ts",
    );
    expect(
      extractModuleSpecifiers(
        'import x from "one"; export { y } from "two"; import("three"); require("four");',
      ),
    ).toEqual(["one", "two", "three", "four"]);
  });
});

describe("security-gate CLI", () => {
  it("never reads or reports .env.local content", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "rentproof-security-gate-"));
    try {
      await mkdir(resolve(directory, "src"), { recursive: true });
      await writeFile(resolve(directory, ".env.example"), "OPENAI_API_KEY=\n", "utf8");
      await writeSecurityPolicyFiles(directory);
      await writeFile(resolve(directory, "src", "safe.ts"), "export const safe = true;\n", "utf8");
      const secret = `sk-${"z".repeat(32)}`;
      await writeFile(
        resolve(directory, ".env.local"),
        `OPENAI_API_KEY=${secret}\n-----BEGIN PRIVATE KEY-----\n`,
        "utf8",
      );
      const script = resolve(process.cwd(), "scripts", "security-gate.mjs");
      const result = await execFileAsync(process.execPath, [script], { cwd: directory });
      expect(result.stdout).toContain("Security gate passed");
      expect(result.stdout).not.toContain(secret);
      expect(result.stderr).not.toContain(secret);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports only path and rule, never matched secret content", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "rentproof-security-gate-"));
    try {
      await mkdir(resolve(directory, "src", "server"), { recursive: true });
      await writeFile(resolve(directory, ".env.example"), "OPENAI_API_KEY=\n", "utf8");
      await writeSecurityPolicyFiles(directory);
      const secret = `sk-${"q".repeat(32)}`;
      await writeFile(
        resolve(directory, "src", "server", "unsafe.ts"),
        `const value="${secret}";`,
        "utf8",
      );
      const script = resolve(process.cwd(), "scripts", "security-gate.mjs");
      await expect(
        execFileAsync(process.execPath, [script], { cwd: directory }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("SECRET_MATERIAL_DETECTED src/server/unsafe.ts"),
      });
      try {
        await execFileAsync(process.execPath, [script], { cwd: directory });
      } catch (error) {
        const output = String((error as { stderr?: string }).stderr ?? "");
        expect(output).not.toContain(secret);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function writeSecurityPolicyFiles(directory: string): Promise<void> {
  await writeFile(resolve(directory, "LICENSE"), validLicense, "utf8");
  await writeFile(resolve(directory, "NOTICE"), validNotice, "utf8");
  await writeFile(resolve(directory, "package.json"), validPackage, "utf8");
}
