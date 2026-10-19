import type { Venue } from "../../../lib/consumer-types";

export function VenueCoverCredit({ credit }: { credit?: NonNullable<Venue["cover"]>["credit"] }) {
  if (credit == null) return null;
  const linked = credit.kind !== "illustration" && credit.url?.startsWith("https://");
  return <span className="gb-venue-cover-credit" data-kind={credit.kind}
    style={{ fontSize: "var(--c23-meta)", lineHeight: "var(--c23-meta-lh)", color: "var(--gb-text-secondary)" }}>
    {linked && credit.url ? <a href={credit.url} target="_blank" rel="noopener noreferrer nofollow">{credit.text} ↗</a> : credit.text}
  </span>;
}
