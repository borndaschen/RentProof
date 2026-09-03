export const PIPELINE_STAGE_ORDER = [
  "listing.extract",
  "evidence.extract",
  "contract.extract",
  "report.compose",
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGE_ORDER)[number];

export const PIPELINE_STAGE_DEPENDENCIES: Readonly<
  Record<PipelineStageId, readonly PipelineStageId[]>
> = Object.freeze({
  "listing.extract": [],
  "evidence.extract": ["listing.extract"],
  "contract.extract": ["evidence.extract"],
  "report.compose": ["contract.extract"],
});
