/** Canonical GoBadminton brand asset from the Visual Designer. */
export function ConsumerLogo({ title = "GoBadminton" }: { title?: string }) {
  return <img className="gb-brand-logo" src="/brand/go-badminton.svg" width={1280} height={728} alt={title} />;
}
