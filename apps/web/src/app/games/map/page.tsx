import { redirect } from "next/navigation";

/** Legacy/bookmark map entrance → canonical Games map view. No new catalogue. */
export default function Page() {
  redirect("/games?view=map");
}
