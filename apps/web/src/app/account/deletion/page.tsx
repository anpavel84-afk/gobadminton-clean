import { redirect } from "next/navigation";

/** Legacy bookmark compatibility; no fixture data is rendered to consumers. */
export default function Page() {
  redirect("/profile/settings");
}
