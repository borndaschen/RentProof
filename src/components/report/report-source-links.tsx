import type { PreSigningReport } from "@/domain/reporting";

function artifactHref(report: PreSigningReport, refId: string): string | null {
  const source = report.sources.find((candidate) => candidate.refId === refId);
  if (
    source === undefined ||
    !/^(?:listing|viewing|contract|follow-up)-[a-z0-9-]+$/u.test(source.locator.artifactId)
  ) {
    return null;
  }
  return `/api/demo/${report.provenance.manifestVersion}/artifacts/${encodeURIComponent(source.locator.artifactId)}`;
}

export function ReportSourceLinks({
  report,
  refs,
}: {
  report: PreSigningReport;
  refs: readonly string[];
}) {
  return (
    <ul className="report-source-links" aria-label="證據來源">
      {refs.map((ref) => {
        const href = artifactHref(report, ref);
        return (
          <li key={ref}>
            {href === null ? (
              <span>受控來源 {ref}（不公開預覽）</span>
            ) : (
              <a href={href}>查看來源 {ref}</a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
