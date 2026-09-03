import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { evaluateSecurityInventory } from "../src/architecture/security-gate-core.mjs";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "coverage",
  "test-results",
  "playwright-report",
]);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".d.ts",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".md",
  ".ps1",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const inventory = [];
await walk(root);
const violations = evaluateSecurityInventory(inventory);
if (violations.length > 0) {
  process.stderr.write(`Security gate failed (${violations.length} violation(s)).\n`);
  for (const violation of violations) {
    process.stderr.write(`${violation.rule} ${violation.path}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`Security gate passed (${inventory.length} files inventoried).\n`);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    const relativePath = relative(root, absolutePath).replace(/\\/gu, "/");
    if (entry.isDirectory()) {
      if (relativePath === ".next") {
        try {
          await walk(resolve(absolutePath, "static"));
        } catch (error) {
          if (error?.code !== "ENOENT") {
            throw error;
          }
        }
        try {
          await collectServerSourceMaps(resolve(absolutePath, "server"));
        } catch (error) {
          if (error?.code !== "ENOENT") {
            throw error;
          }
        }
        continue;
      }
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }
      await walk(absolutePath);
      continue;
    }
    if (entry.isSymbolicLink()) {
      inventory.push({ path: relativePath, content: null });
      continue;
    }
    if (!entry.isFile() || isLocalEnvironmentFile(entry.name)) {
      continue;
    }
    const extension = compoundExtension(entry.name);
    const shouldRead =
      entry.name === ".env.example" ||
      relativePath === "LICENSE" ||
      relativePath === "NOTICE" ||
      relativePath === "package.json" ||
      textExtensions.has(extension) ||
      relativePath.startsWith(".next/static/");
    inventory.push({
      path: relativePath,
      content: shouldRead ? await readFile(absolutePath, "utf8") : null,
    });
  }
}

async function collectServerSourceMaps(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectServerSourceMaps(absolutePath);
    } else if (entry.isFile() && entry.name.endsWith(".map")) {
      inventory.push({ path: relative(root, absolutePath).replace(/\\/gu, "/"), content: null });
    }
  }
}

function isLocalEnvironmentFile(name) {
  const lower = name.toLowerCase();
  return lower === ".env.local" || /^\.env\..+\.local$/u.test(lower);
}

function compoundExtension(name) {
  return name.endsWith(".d.ts") ? ".d.ts" : extname(name).toLowerCase();
}
