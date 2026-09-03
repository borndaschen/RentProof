const LOCKFILE_NAMES = new Set(["package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"]);

const APACHE_2_LICENSE_MARKERS = [
  "Apache License",
  "Version 2.0, January 2004",
  "http://www.apache.org/licenses/",
  "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
  "1. Definitions.",
  "2. Grant of Copyright License.",
  "3. Grant of Patent License.",
  "4. Redistribution.",
  "5. Submission of Contributions.",
  "6. Trademarks.",
  "7. Disclaimer of Warranty.",
  "8. Limitation of Liability.",
  "9. Accepting Warranty or Additional Liability.",
  "END OF TERMS AND CONDITIONS",
  "APPENDIX: How to apply the Apache License to your work.",
];

const NOTICE_MARKERS = [
  "RentProof",
  "Copyright 2026 borndaschen",
  "This product includes software developed by RentProof contributors.",
  "Third-party software remains subject to its respective license terms.",
];

const MEDIA_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".avif",
  ".pdf",
  ".mp4",
  ".mov",
  ".wav",
  ".mp3",
]);

const SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[a-z0-9_-]{20,}\b/iu,
  /\bsk_(?:live|test)_[a-z0-9]{16,}\b/iu,
  /-----BEGIN ((?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY)-----[\s\S]{32,}-----END \1-----/u,
];

const PII_PATTERNS = [
  /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/iu,
  /(?:^|[^0-9])(?:\+?886[-\s]?)?0?9\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/u,
  /\b[A-Z][12]\d{8}\b/iu,
  /(?:銀行帳號|匯款帳號|收款帳號|信用卡號|bank account|card number)\s*(?:=|:|：)?\s*(?:\d[ -]?){8,20}\b/iu,
  /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*(?:;base64)?,/iu,
  /(?:qr(?:\s*code)?|qr碼|二維碼)\s*(?:=|:|：)\s*\S{8,}/iu,
];

/**
 * @param {readonly {path: string, content?: string | null}[]} inventory
 * @param {{requireEnvExample?: boolean, requireLicensePolicy?: boolean}} [options]
 * @returns {{path: string, rule: string}[]}
 */
export function evaluateSecurityInventory(inventory, options = {}) {
  const requireEnvExample = options.requireEnvExample ?? true;
  const requireLicensePolicy = options.requireLicensePolicy ?? true;
  const violations = [];
  let envExampleFound = false;
  let rootLicense = null;
  let rootNotice = null;
  let rootPackage = null;

  for (const entry of inventory) {
    const path = normalizeInventoryPath(entry.path);
    const lowerPath = path.toLowerCase();
    const baseName = lowerPath.split("/").at(-1) ?? lowerPath;
    const content = typeof entry.content === "string" ? entry.content : null;

    if (baseName === ".env.local" || /^\.env\..+\.local$/u.test(baseName)) {
      continue;
    }
    if (LOCKFILE_NAMES.has(baseName)) {
      addViolation(violations, path, "PACKAGE_MANAGER_LOCKFILE_FORBIDDEN");
    }
    if (lowerPath.startsWith(".next/server/") && lowerPath.endsWith(".map")) {
      addViolation(violations, path, "SERVER_SOURCE_MAP_FORBIDDEN");
    }
    if (/^(?:license|copying)(?:\..+)?$/iu.test(baseName)) {
      if (lowerPath === "license") {
        rootLicense = content;
      } else {
        addViolation(violations, path, "LICENSE_FILE_AMBIGUOUS");
      }
    }
    if (lowerPath === "notice") {
      rootNotice = content;
    }
    if (lowerPath === "package.json") {
      rootPackage = content;
    }
    if (isDemoAssetPath(lowerPath)) {
      addViolation(violations, path, "DEMO_ASSET_IN_REPOSITORY");
    }

    if (baseName === ".env.example") {
      envExampleFound = true;
      if (content === null || envExampleContainsSecret(content)) {
        addViolation(violations, path, "ENV_EXAMPLE_SECRET_VALUE");
      }
    }
    if (content === null) {
      continue;
    }

    const selfScanningExempt =
      lowerPath.startsWith("src/architecture/") || lowerPath === "scripts/security-gate.mjs";
    if (!selfScanningExempt && SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
      addViolation(violations, path, "SECRET_MATERIAL_DETECTED");
    }
    if (
      !selfScanningExempt &&
      !nextPublicGuardExempt(lowerPath) &&
      /NEXT_PUBLIC_[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)/u.test(content)
    ) {
      addViolation(violations, path, "NEXT_PUBLIC_SECRET_NAME_FORBIDDEN");
    }

    const clientSource =
      lowerPath.startsWith(".next/static/") ||
      lowerPath.startsWith("src/components/") ||
      /^\s*["']use client["'];?/mu.test(content);
    if (
      clientSource &&
      /(?:OPENAI_API_KEY|CLERK_SECRET_KEY|\bsk-(?:proj-)?[a-z0-9_-]{20,}|\bsk_(?:live|test)_[a-z0-9]{16,})/iu.test(
        content,
      )
    ) {
      addViolation(violations, path, "CLIENT_SECRET_REFERENCE_FORBIDDEN");
    }

    const imports = extractModuleSpecifiers(content);
    if (lowerPath.startsWith("src/domain/") || lowerPath.startsWith("src/application/")) {
      if (imports.some(isForbiddenInnerLayerImport)) {
        addViolation(violations, path, "INNER_LAYER_IMPORT_BOUNDARY");
      }
    }
    for (const specifier of imports) {
      if (!lowerPath.startsWith("src/architecture/") && !sdkImportAllowed(lowerPath, specifier)) {
        addViolation(violations, path, "SDK_IMPORT_NOT_ALLOWLISTED");
      }
    }

    if (
      (lowerPath.startsWith("src/app/") || lowerPath.startsWith("src/components/")) &&
      /\bfixture\b/iu.test(content) &&
      extractStaticModuleSpecifiers(content).some(
        (specifier) =>
          specifier.includes("/live/") ||
          specifier.includes("live-conversation") ||
          specifier.startsWith("@/adapters/openai") ||
          specifier === "openai",
      )
    ) {
      addViolation(violations, path, "FIXTURE_STATIC_IMPORTS_LIVE_ADAPTER");
    }

    if (shouldScanForPii(lowerPath) && PII_PATTERNS.some((pattern) => pattern.test(content))) {
      addViolation(violations, path, "HIGH_CONFIDENCE_PII_OR_PAYLOAD_DETECTED");
    }
  }

  if (requireEnvExample && !envExampleFound) {
    addViolation(violations, ".env.example", "ENV_EXAMPLE_MISSING");
  }
  if (requireLicensePolicy) {
    validateApacheLicensePolicy(violations, rootLicense, rootNotice, rootPackage);
  }
  return violations.sort(
    (left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule),
  );
}

function validateApacheLicensePolicy(violations, licenseContent, noticeContent, packageContent) {
  if (licenseContent === null) {
    addViolation(violations, "LICENSE", "APACHE_LICENSE_MISSING_OR_UNREADABLE");
  } else if (!hasOrderedMarkers(licenseContent, APACHE_2_LICENSE_MARKERS)) {
    addViolation(violations, "LICENSE", "APACHE_LICENSE_INVALID");
  }

  if (noticeContent === null) {
    addViolation(violations, "NOTICE", "APACHE_NOTICE_MISSING_OR_UNREADABLE");
  } else if (!hasOrderedMarkers(noticeContent, NOTICE_MARKERS)) {
    addViolation(violations, "NOTICE", "APACHE_NOTICE_INVALID");
  }

  if (packageContent === null) {
    addViolation(violations, "package.json", "PACKAGE_LICENSE_METADATA_MISSING_OR_UNREADABLE");
    return;
  }
  try {
    const parsed = JSON.parse(packageContent);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      parsed.license !== "Apache-2.0" ||
      parsed.private !== true
    ) {
      addViolation(violations, "package.json", "PACKAGE_LICENSE_METADATA_INVALID");
    }
  } catch {
    addViolation(violations, "package.json", "PACKAGE_LICENSE_METADATA_INVALID");
  }
}

function hasOrderedMarkers(content, markers) {
  let cursor = 0;
  for (const marker of markers) {
    const next = content.indexOf(marker, cursor);
    if (next < 0) return false;
    cursor = next + marker.length;
  }
  return true;
}

/** @param {string} content */
export function extractModuleSpecifiers(content) {
  const specifiers = [];
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/gu,
    /import\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /require\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1] !== undefined) {
        specifiers.push(match[1]);
      }
    }
  }
  return [...new Set(specifiers)];
}

function extractStaticModuleSpecifiers(content) {
  const specifiers = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/gu;
  for (const match of content.matchAll(pattern)) {
    if (match[1] !== undefined) {
      specifiers.push(match[1]);
    }
  }
  return [...new Set(specifiers)];
}

/** @param {string} path */
export function normalizeInventoryPath(path) {
  return path
    .replace(/\\/gu, "/")
    .replace(/^[a-z]:\//iu, "")
    .replace(/^\.\//u, "");
}

function isForbiddenInnerLayerImport(specifier) {
  const lower = specifier.toLowerCase();
  return (
    lower === "openai" ||
    lower === "sharp" ||
    lower === "pdfjs-dist" ||
    lower.startsWith("pdfjs-dist/") ||
    lower.startsWith("@clerk/") ||
    lower === "fs" ||
    lower === "node:fs" ||
    lower === "node:fs/promises" ||
    lower.startsWith("@/adapters/") ||
    lower.includes("/adapters/")
  );
}

function sdkImportAllowed(path, specifier) {
  const lower = specifier.toLowerCase();
  if (lower === "openai") {
    return path.startsWith("src/adapters/openai/");
  }
  if (lower === "sharp") {
    return path.startsWith("src/adapters/ingestion/sharp/");
  }
  if (lower === "pdfjs-dist" || lower.startsWith("pdfjs-dist/")) {
    return path.startsWith("src/adapters/documents/pdfjs/");
  }
  if (lower.startsWith("@clerk/")) {
    return false;
  }
  return true;
}

function envExampleContainsSecret(content) {
  for (const line of content.split(/\r?\n/u)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);
    if (
      match?.[1] !== undefined &&
      match[2] !== undefined &&
      /(?:KEY|SECRET|TOKEN|PASSWORD)$/u.test(match[1]) &&
      match[2].length > 0
    ) {
      return true;
    }
  }
  return false;
}

function shouldScanForPii(path) {
  return (
    (path.startsWith("src/") || path.startsWith("scripts/")) &&
    !path.includes(".test.") &&
    !path.includes("/__tests__/") &&
    !path.startsWith("src/architecture/") &&
    path !== "scripts/security-gate.mjs"
  );
}

function nextPublicGuardExempt(path) {
  return (
    path.startsWith("docs/") ||
    path === "agents.md" ||
    path === "src/server/env.ts" ||
    path === "scripts/run-next.mjs"
  );
}

function isDemoAssetPath(path) {
  if (
    path.includes("rentproof-demo/") ||
    path.includes("/fixtures/") ||
    path.startsWith("fixtures/") ||
    path.includes("golden-case/") ||
    /(?:^|\/)cases\/golden-v[1-9][0-9]*(?:\/|$)/u.test(path)
  ) {
    return true;
  }
  const extensionIndex = path.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? path.slice(extensionIndex) : "";
  return MEDIA_EXTENSIONS.has(extension) && !path.startsWith("rules/snapshots/");
}

function addViolation(violations, path, rule) {
  if (!violations.some((violation) => violation.path === path && violation.rule === rule)) {
    violations.push({ path, rule });
  }
}
