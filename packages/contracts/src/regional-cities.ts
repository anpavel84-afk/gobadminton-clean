/** Immutable #485 regional city literals — bounded data reuse, not a provider registry. */
export const REGIONAL_CITY_RADIUS_METERS = 40000 as const;

export type RegionalCity = {
  readonly id: string;
  readonly nameRu: string;
  readonly nameEn: string;
  readonly slug: string;
  readonly timezone: string;
  readonly centerLatitude: number;
  readonly centerLongitude: number;
  readonly centerSourceUrl: string;
  readonly centerCheckedAt: string;
  readonly radiusMeters: typeof REGIONAL_CITY_RADIUS_METERS;
};

export const REGIONAL_CITIES = [
  {
    id: "1775016f-373e-5a15-958b-1305770b2b16",
    nameRu: "Новосибирск",
    nameEn: "Novosibirsk",
    slug: "novosibirsk",
    timezone: "Asia/Novosibirsk",
    centerLatitude: 55.0288307,
    centerLongitude: 82.9226887,
    centerSourceUrl: "https://www.openstreetmap.org/relation/1751445",
    centerCheckedAt: "2026-11-06T15:20:14.517631+00:00",
    radiusMeters: REGIONAL_CITY_RADIUS_METERS,
  },
  {
    id: "bec5831e-d6d2-59da-9d17-0c32b1eca331",
    nameRu: "Екатеринбург",
    nameEn: "Yekaterinburg",
    slug: "yekaterinburg",
    timezone: "Asia/Yekaterinburg",
    centerLatitude: 56.8382071,
    centerLongitude: 60.6007886,
    centerSourceUrl: "https://www.openstreetmap.org/relation/6564910",
    centerCheckedAt: "2026-11-06T15:20:15.718990+00:00",
    radiusMeters: REGIONAL_CITY_RADIUS_METERS,
  },
  {
    id: "5c219eb1-87da-5fd3-9194-20e9d1501315",
    nameRu: "Казань",
    nameEn: "Kazan",
    slug: "kazan",
    timezone: "Europe/Moscow",
    centerLatitude: 55.7946485,
    centerLongitude: 49.1115022,
    centerSourceUrl: "https://www.openstreetmap.org/relation/3437391",
    centerCheckedAt: "2026-11-06T15:20:17.023417+00:00",
    radiusMeters: REGIONAL_CITY_RADIUS_METERS,
  },
  {
    id: "3113cbf1-c8bd-5475-9774-2e9567414f46",
    nameRu: "Нижний Новгород",
    nameEn: "Nizhny Novgorod",
    slug: "nizhny-novgorod",
    timezone: "Europe/Moscow",
    centerLatitude: 56.3264816,
    centerLongitude: 44.0051395,
    centerSourceUrl: "https://www.openstreetmap.org/relation/1752948",
    centerCheckedAt: "2026-11-06T15:20:18.530991+00:00",
    radiusMeters: REGIONAL_CITY_RADIUS_METERS,
  },
  {
    id: "1a08b6d0-7bb8-5df5-903d-633ebc064a6e",
    nameRu: "Красноярск",
    nameEn: "Krasnoyarsk",
    slug: "krasnoyarsk",
    timezone: "Asia/Krasnoyarsk",
    centerLatitude: 56.0091173,
    centerLongitude: 92.872586,
    centerSourceUrl: "https://www.openstreetmap.org/relation/1430616",
    centerCheckedAt: "2026-11-06T15:20:19.758414+00:00",
    radiusMeters: REGIONAL_CITY_RADIUS_METERS,
  },
  {
    id: "2f9a0a40-b6cd-53f6-8f0d-06cfb607cd0e",
    nameRu: "Самара",
    nameEn: "Samara",
    slug: "samara",
    timezone: "Europe/Samara",
    centerLatitude: 53.1956255,
    centerLongitude: 50.1014927,
    centerSourceUrl: "https://www.openstreetmap.org/relation/3368701",
    centerCheckedAt: "2026-11-06T15:20:21.435010+00:00",
    radiusMeters: REGIONAL_CITY_RADIUS_METERS,
  },
  {
    id: "38d822e9-2c2a-5969-871c-ee6da3c702da",
    nameRu: "Ростов-на-Дону",
    nameEn: "Rostov-on-Don",
    slug: "rostov-on-don",
    timezone: "Europe/Moscow",
    centerLatitude: 47.2222596,
    centerLongitude: 39.7198736,
    centerSourceUrl: "https://www.openstreetmap.org/relation/1285772",
    centerCheckedAt: "2026-11-06T15:20:22.969807+00:00",
    radiusMeters: REGIONAL_CITY_RADIUS_METERS,
  },
  {
    id: "17b9f926-c927-59be-9adb-1434a971e2e4",
    nameRu: "Краснодар",
    nameEn: "Krasnodar",
    slug: "krasnodar",
    timezone: "Europe/Moscow",
    centerLatitude: 45.0351532,
    centerLongitude: 38.9772396,
    centerSourceUrl: "https://www.openstreetmap.org/relation/7373058",
    centerCheckedAt: "2026-11-06T15:20:24.270739+00:00",
    radiusMeters: REGIONAL_CITY_RADIUS_METERS,
  },
  {
    id: "cc3fde74-3c6d-5dc6-8e87-eb463e45ade3",
    nameRu: "Омск",
    nameEn: "Omsk",
    slug: "omsk",
    timezone: "Asia/Omsk",
    centerLatitude: 54.991375,
    centerLongitude: 73.371529,
    centerSourceUrl: "https://www.openstreetmap.org/relation/1558108",
    centerCheckedAt: "2026-11-06T15:20:25.523964+00:00",
    radiusMeters: REGIONAL_CITY_RADIUS_METERS,
  },
  {
    id: "f89658dd-d378-593d-9ec0-b8dae693f0af",
    nameRu: "Воронеж",
    nameEn: "Voronezh",
    slug: "voronezh",
    timezone: "Europe/Moscow",
    centerLatitude: 51.6605982,
    centerLongitude: 39.2005858,
    centerSourceUrl: "https://www.openstreetmap.org/relation/3536492",
    centerCheckedAt: "2026-11-06T15:20:26.873325+00:00",
    radiusMeters: REGIONAL_CITY_RADIUS_METERS,
  },
  {
    id: "dc1f0006-1076-5e28-8608-63ecd96240eb",
    nameRu: "Волгоград",
    nameEn: "Volgograd",
    slug: "volgograd",
    timezone: "Europe/Volgograd",
    centerLatitude: 48.7081906,
    centerLongitude: 44.5153353,
    centerSourceUrl: "https://www.openstreetmap.org/relation/3374767",
    centerCheckedAt: "2026-11-06T15:20:28.334070+00:00",
    radiusMeters: REGIONAL_CITY_RADIUS_METERS,
  },
] as const satisfies readonly RegionalCity[];

export type RegionalCityId = (typeof REGIONAL_CITIES)[number]["id"];

const BY_ID: ReadonlyMap<string, (typeof REGIONAL_CITIES)[number]> = new Map(
  REGIONAL_CITIES.map((city) => [city.id, city]),
);

export function regionalCityById(cityId: string | null | undefined): (typeof REGIONAL_CITIES)[number] | null {
  if (!cityId) return null;
  return BY_ID.get(cityId) ?? null;
}

export function isRegionalCityId(cityId: string | null | undefined): boolean {
  return regionalCityById(cityId) !== null;
}

