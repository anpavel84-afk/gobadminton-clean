/** Static finite regional map packs for public games/venues — #485 descriptors only. */
export type RegionalMapPack = {
  readonly version: string;
  readonly mapId: string;
  readonly cityId: string;
  readonly cityLabel: string;
  readonly prefix: string;
  readonly styleHash: string;
  readonly center: readonly [number, number];
  readonly bounds: readonly [readonly [number, number], readonly [number, number]];
  readonly defaultZoom: number;
};

export const REGIONAL_MAP_PACKS = [
  {
    version: "novosibirsk-20261106-p4-a6ed9f64-v001",
    mapId: "novosibirsk",
    cityId: "1775016f-373e-5a15-958b-1305770b2b16",
    cityLabel: "Новосибирск",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/novosibirsk-20261106-p4-a6ed9f64-v001/",
    styleHash: "a10e2b090f052e32ba47cd690d67166515083cd243cf1721d76d1bfea93b0a0c",
    center: [82.9226887, 55.0288307] as const,
    bounds: [[82.1821334449726, 54.6088307], [83.66324395502738, 55.4488307]] as const,
    defaultZoom: 10.5,
  },
  {
    version: "yekaterinburg-20261106-p4-f6d8c8b6-v001",
    mapId: "yekaterinburg",
    cityId: "bec5831e-d6d2-59da-9d17-0c32b1eca331",
    cityLabel: "Екатеринбург",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/yekaterinburg-20261106-p4-f6d8c8b6-v001/",
    styleHash: "56f1d2385152d5b156510734f81e6c5252d12b09e2fc30a8b0d5acec33b79387",
    center: [60.6007886, 56.8382071] as const,
    bounds: [[59.824238913432914, 56.4182071], [61.37733828656709, 57.2582071]] as const,
    defaultZoom: 10.5,
  },
  {
    version: "kazan-20261106-p4-23932c53-v001",
    mapId: "kazan",
    cityId: "5c219eb1-87da-5fd3-9194-20e9d1501315",
    cityLabel: "Казань",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/kazan-20261106-p4-23932c53-v001/",
    styleHash: "7ecd4d4840692e24d58a63f827fc3c76a64b42dd63a6f0c465505ccfe948829a",
    center: [49.1115022, 55.7946485] as const,
    bounds: [[48.35621946126495, 55.3746485], [49.866784938735044, 56.2146485]] as const,
    defaultZoom: 10.5,
  },
  {
    version: "nizhny-novgorod-20261106-p4-da507726-v001",
    mapId: "nizhny-novgorod",
    cityId: "3113cbf1-c8bd-5475-9774-2e9567414f46",
    cityLabel: "Нижний Новгород",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/nizhny-novgorod-20261106-p4-da507726-v001/",
    styleHash: "f9e26076f2742b2cbdb811e78f8edd433bdbb036aed46e5594d5ddfbf56cb272",
    center: [44.0051395, 56.3264816] as const,
    bounds: [[43.2391977671483, 55.9064816], [44.7710812328517, 56.7464816]] as const,
    defaultZoom: 10.5,
  },
  {
    version: "krasnoyarsk-20261106-p4-606a2792-v001",
    mapId: "krasnoyarsk",
    cityId: "1a08b6d0-7bb8-5df5-903d-633ebc064a6e",
    cityLabel: "Красноярск",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/krasnoyarsk-20261106-p4-606a2792-v001/",
    styleHash: "88c9b39de6f3e8a27afe0b36735c4bfb42173be0a0b26feb66a68304d754ae4a",
    center: [92.872586, 56.0091173] as const,
    bounds: [[92.11304864302863, 55.5891173], [93.63212335697136, 56.4291173]] as const,
    defaultZoom: 10.5,
  },
  {
    version: "samara-20261106-p4-ac978012-v001",
    mapId: "samara",
    cityId: "2f9a0a40-b6cd-53f6-8f0d-06cfb607cd0e",
    cityLabel: "Самара",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/samara-20261106-p4-ac978012-v001/",
    styleHash: "fa97fef853f911f5d8a2533c4bd537ddf78be8cbf74e9dba77cdb3ab30eb4e44",
    center: [50.1014927, 53.1956255] as const,
    bounds: [[49.39346765715722, 52.7756255], [50.809517742842786, 53.6156255]] as const,
    defaultZoom: 10.5,
  },
  {
    version: "rostov-on-don-20261106-p4-17f21674-v001",
    mapId: "rostov-on-don",
    cityId: "38d822e9-2c2a-5969-871c-ee6da3c702da",
    cityLabel: "Ростов-на-Дону",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/rostov-on-don-20261106-p4-17f21674-v001/",
    styleHash: "39945f0e37c2eefd1e47513f025df397395da261a0e14dddc5a61218f7cea9c4",
    center: [39.7198736, 47.2222596] as const,
    bounds: [[39.09650395497187, 46.8022596], [40.34324324502813, 47.6422596]] as const,
    defaultZoom: 10.5,
  },
  {
    version: "krasnodar-20261106-p4-c9e7f371-v001",
    mapId: "krasnodar",
    cityId: "17b9f926-c927-59be-9adb-1434a971e2e4",
    cityLabel: "Краснодар",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/krasnodar-20261106-p4-c9e7f371-v001/",
    styleHash: "cc71d8890be1e0bb607d12dfd3e9167bdf66daf8ec9faa3d2b5385a9d4ed7219",
    center: [38.9772396, 45.0351532] as const,
    bounds: [[38.37849467884494, 44.6151532], [39.57598452115506, 45.455153200000005]] as const,
    defaultZoom: 10.5,
  },
  {
    version: "omsk-20261106-p4-b1be1c48-v001",
    mapId: "omsk",
    cityId: "cc3fde74-3c6d-5dc6-8e87-eb463e45ade3",
    cityLabel: "Омск",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/omsk-20261106-p4-b1be1c48-v001/",
    styleHash: "a004ac255b59cefac5a6695469bf1999f92dd87d818b3f95ef62dd0edd7f811b",
    center: [73.371529, 54.991375] as const,
    bounds: [[72.63167597277582, 54.571374999999996], [74.11138202722417, 55.411375]] as const,
    defaultZoom: 10.5,
  },
  {
    version: "voronezh-20261106-p4-01abc364-v001",
    mapId: "voronezh",
    cityId: "f89658dd-d378-593d-9ec0-b8dae693f0af",
    cityLabel: "Воронеж",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/voronezh-20261106-p4-01abc364-v001/",
    styleHash: "306adabebed284539dec9c7e14113eda64df6ac2ff6f1913af82c158122c06d2",
    center: [39.2005858, 51.6605982] as const,
    bounds: [[38.51716153643916, 51.2405982], [39.88401006356084, 52.080598200000004]] as const,
    defaultZoom: 10.5,
  },
  {
    version: "volgograd-20261106-p4-40c5114e-v001",
    mapId: "volgograd",
    cityId: "dc1f0006-1076-5e28-8608-63ecd96240eb",
    cityLabel: "Волгоград",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/volgograd-20261106-p4-40c5114e-v001/",
    styleHash: "30577ab7680e866df7b8288f665765f24e61000531e46ec7d9bb2d5f014e8386",
    center: [44.5153353, 48.7081906] as const,
    bounds: [[43.87349544747879, 48.2881906], [45.157175152521205, 49.1281906]] as const,
    defaultZoom: 10.5,
  },
] as const satisfies readonly RegionalMapPack[];

const BY_CITY: ReadonlyMap<string, (typeof REGIONAL_MAP_PACKS)[number]> = new Map(
  REGIONAL_MAP_PACKS.map((pack) => [pack.cityId, pack]),
);

export function regionalMapPackForCity(cityId: string | null | undefined): (typeof REGIONAL_MAP_PACKS)[number] | null {
  if (!cityId) return null;
  return BY_CITY.get(cityId) ?? null;
}

