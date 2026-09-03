export type SecurityInventoryEntry = {
  path: string;
  content?: string | null;
};

export type SecurityGateViolation = {
  path: string;
  rule: string;
};

export function evaluateSecurityInventory(
  inventory: readonly SecurityInventoryEntry[],
  options?: { requireEnvExample?: boolean; requireLicensePolicy?: boolean },
): SecurityGateViolation[];

export function extractModuleSpecifiers(content: string): string[];
export function normalizeInventoryPath(path: string): string;
