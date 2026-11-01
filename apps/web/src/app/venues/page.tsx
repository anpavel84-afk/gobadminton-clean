import { redirect } from "next/navigation";

/** Legacy «Назад к карте» /venues entrance → canonical Games map. No venue catalogue. */
export default function Page() {
  redirect("/games?view=map");
}
