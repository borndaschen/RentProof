import { z } from "zod";

export const DEMO_MANIFEST_SCHEMA_ID = "rentproof.demo-manifest.v1" as const;
export const DEMO_MANIFEST_MAX_BYTES = 1_048_576;
export const DEMO_MANIFEST_MAX_FILES = 100;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const CaseVersionSchema = z.string().regex(/^golden-v[1-9][0-9]*$/u);
const IdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u);
const MimeTypeSchema = z
  .string()
  .max(127)
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u);

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const WINDOWS_INVALID_CHARACTER = /[<>:"|?*\u0000-\u001f]/u;

export function isWindowsSafeManifestPath(path: string): boolean {
  if (
    path.length === 0 ||
    path.length > 240 ||
    path !== path.normalize("NFC") ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[a-z]:/iu.test(path) ||
    WINDOWS_INVALID_CHARACTER.test(path)
  ) {
    return false;
  }

  const segments = path.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.endsWith(".") &&
      !segment.endsWith(" ") &&
      !WINDOWS_RESERVED_NAME.test(segment),
  );
}

export function windowsPathCollisionKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

export const DemoManifestFileSchema = z
  .object({
    id: IdentifierSchema,
    path: z.string().refine(isWindowsSafeManifestPath, "Unsafe Windows relative path"),
    kind: z.enum([
      "listing",
      "viewing",
      "contract",
      "interaction",
      "follow_up",
      "truth",
      "fallback",
    ]),
    mime: MimeTypeSchema,
    bytes: z.number().int().nonnegative().finite(),
    sha256: Sha256Schema,
    provenance: z
      .object({
        source: z.string().trim().min(1).max(512),
        license: z.string().trim().min(1).max(256),
      })
      .strict(),
  })
  .strict();

export const DemoManifestSchema = z
  .object({
    schema: z.literal(DEMO_MANIFEST_SCHEMA_ID),
    datasetId: IdentifierSchema,
    caseVersion: CaseVersionSchema,
    synthetic: z.literal(true),
    createdAt: z.iso.datetime({ offset: true }),
    sealedAt: z.iso.datetime({ offset: true }),
    files: z.array(DemoManifestFileSchema).max(DEMO_MANIFEST_MAX_FILES),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = new Set<string>();
    const paths = new Set<string>();

    for (const [index, file] of manifest.files.entries()) {
      if (ids.has(file.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate file id: ${file.id}`,
          path: ["files", index, "id"],
        });
      }
      ids.add(file.id);

      const collisionKey = windowsPathCollisionKey(file.path);
      if (paths.has(collisionKey)) {
        context.addIssue({
          code: "custom",
          message: `Case-insensitive path collision: ${file.path}`,
          path: ["files", index, "path"],
        });
      }
      paths.add(collisionKey);
    }
  });

export type DemoManifest = z.infer<typeof DemoManifestSchema>;
export type DemoManifestFile = z.infer<typeof DemoManifestFileSchema>;
