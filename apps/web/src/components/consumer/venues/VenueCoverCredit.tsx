import type { Venue } from "../../../lib/consumer-types";
import { httpsCreditUrl } from "../../../lib/original-http-authority";

export function VenueCoverCredit({ credit }: { credit?: NonNullable<Venue["cover"]>["credit"] }) {
  if (credit == null) return null;
  const href = credit.kind === "illustration" ? null : httpsCreditUrl(credit.url);
  return <span className="gb-venue-cover-credit" data-kind={credit.kind}
    style={{ fontSize: "var(--c23-meta)", lineHeight: "var(--c23-meta-lh)", color: "var(--gb-text-secondary)" }}>
    {href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{credit.text} ↗</a> : credit.text}
  </span>;
}
