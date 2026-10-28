"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ConsumerShell } from "../ConsumerShell";
import { PublicPlayerProfile } from "../players/PublicPlayerProfile";
import { safeProfileReturnPath } from "../../../lib/profile-return";

/** Thin route wrapper: shell + back link around the shared public-profile body. */
export function PublicPlayerProfilePage() {
  const { publicPlayerId } = useParams<{ publicPlayerId: string }>();
  const search = useSearchParams();
  const returnPath = safeProfileReturnPath(search.get("returnTo"));
  return <ConsumerShell active="players" title="Профиль игрока" mode="local">
    <Link className="back-link" href={returnPath}>{returnPath === "/players" ? "← Все игроки" : "← К переписке"}</Link>
    <PublicPlayerProfile publicPlayerId={publicPlayerId} />
  </ConsumerShell>;
}
