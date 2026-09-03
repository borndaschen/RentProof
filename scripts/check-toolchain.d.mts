export type ToolchainContract = Readonly<{ nodeVersion: string; pnpmVersion: string }>;

export function parseToolchainContract(
  nodeVersionText: string,
  packageJsonText: string,
): ToolchainContract;

export function verifyActualToolchain(
  contract: ToolchainContract,
  actual: Readonly<{ nodeVersion: string; pnpmVersion: string }>,
): ToolchainContract;

export function runToolchainCheck(
  repositoryRoot: string,
  pnpmUserAgent?: string,
): ToolchainContract;
