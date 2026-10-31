"use client";
import { useState } from "react";
import type { Venue, VenueProfile } from "../../../lib/consumer-types";
import { httpsCreditUrl } from "../../../lib/original-http-authority";
import { VenueCoverCredit } from "./VenueCoverCredit";
import { venueCoverUrl } from "./VenueCover";
import { VenuePublicContacts } from "../games/VenueSheet";
import "../../../styles/venue-public-profile.css";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function amenity(value: unknown): string {
  return value === true ? "Есть" : value === false ? "Нет" : "Нет данных";
}

// V1a emits canonical ISO UTC. Do not substitute generic/private timestamps or today.
function contentDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
}

function readDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 1 || text.length > 500) return null;
  if (Array.from(text).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  })) return null;
  return text;
}

function galleryPhotos(value: unknown): VenueProfile["gallery"]["items"] {
  const gallery = record(value);
  if (gallery.coverage !== "ordered" && gallery.coverage !== "cover_only") return [];
  if (!Array.isArray(gallery.items)) return [];
  const photos: VenueProfile["gallery"]["items"] = [];
  for (const raw of gallery.items) {
    const item = record(raw), credit = record(item.credit);
    const url = venueCoverUrl(item.url);
    const attribution = httpsCreditUrl(credit.url);
    if (!url || credit.kind !== "photo"
      || typeof credit.text !== "string" || !credit.text.startsWith("Фото: ")
      || credit.text.trim().length <= 6 || credit.text.length > 120
      || Array.from(credit.text).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
      })
      || !attribution) continue;
    photos.push({
      id: typeof item.id === "string" ? item.id : url,
      url,
      credit: { kind: "photo", text: credit.text, url: attribution },
    });
  }
  return photos;
}

function ProfilePhoto({ photo }: { photo: VenueProfile["gallery"]["items"][number] }) {
  const [failed, setFailed] = useState(false);
  return <section className="gb-venue-profile-section" aria-label="Фото площадки">
    <h2>Фото площадки</h2>
    {failed ? <p>Фото временно недоступно.</p> : <figure>
      <img src={photo.url} alt="Фото площадки" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      <figcaption><VenueCoverCredit credit={photo.credit} /></figcaption>
    </figure>}
  </section>;
}

/** Allowlisted public facts only. Never stringify arbitrary API/private metadata. */
export function VenuePublicProfile({
  venue,
  omitContacts = false,
}: {
  venue: Pick<Venue, "profile" | "cover" | "publicContacts">;
  /** Opt out when a parent (e.g. VenuePage rail) already renders contacts once. Default keeps standalone consumers. */
  omitContacts?: boolean;
}) {
  const profile = record(venue.profile), amenities = record(profile.amenities);
  const count = profile.courtCount;
  const courtCount = typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= 2147483647 ? count : null;
  const updatedAt = contentDate(profile.updatedAt);
  const description = readDescription(profile.description);
  const photos = galleryPhotos(profile.gallery);
  return <div className="gb-venue-public-profile">
    <section className="gb-venue-profile-section" aria-label="О площадке">
      <h2>О площадке</h2>
      {description && <p className="gb-venue-profile-description">{description}</p>}
      <dl className="gb-venue-profile-facts">
        <div><dt>Количество кортов</dt><dd>{courtCount ?? "Нет данных"}</dd></div>
        <div><dt>Парковка</dt><dd>{amenity(amenities.parking)}</dd></div>
        <div><dt>Душевые</dt><dd>{amenity(amenities.showers)}</dd></div>
      </dl>
      {updatedAt && <p className="gb-venue-profile-updated">Содержимое обновлено: <time dateTime={updatedAt}>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(updatedAt))}</time></p>}
    </section>
    {!omitContacts && <VenuePublicContacts value={venue.publicContacts} />}
    {photos.map((photo) => <ProfilePhoto key={photo.id} photo={photo} />)}
  </div>;
}
