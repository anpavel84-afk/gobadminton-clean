import { VenuePage } from "../../../components/consumer/venues/VenuePage";
import { resolveApiBaseUrl } from "../../../lib/api";
import type { Venue } from "../../../lib/consumer-types";

export default async function Page({params}:{params:Promise<{venueId:string}>}) {
  const {venueId}=await params;
  // Request-scoped public projection only. Visibility remains the public API's decision.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let initialVenue: Venue | null = null;
  try {
    const response = await fetch(`${resolveApiBaseUrl()}/v1/venues/${encodeURIComponent(venueId)}`, {
      cache: "no-store",
      redirect: "error",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.ok) {
      const value = await response.json() as Venue | null;
      if (!controller.signal.aborted && value?.id === venueId) initialVenue = value;
    }
  } catch {
    // Not found, timeout and transport failures all retain the public retry UI.
  } finally {
    clearTimeout(timer);
  }
  return <VenuePage key={venueId} venueId={venueId} initialVenue={initialVenue} initialUnavailable={!initialVenue}/>;
}
