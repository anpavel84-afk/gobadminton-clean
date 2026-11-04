import { redirect } from "next/navigation";

/** Short /map bookmark → canonical Games map view. No new catalogue. */
export default function Page() {
  redirect("/games?view=map");
}
