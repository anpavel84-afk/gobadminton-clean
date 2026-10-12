import {
  DEMO_CITY_ID,
  DEMO_ISSUER_NAMESPACE,
  DEMO_MOSCOW_CITY_ID,
  DEMO_SPB_CITY_ID,
  demoGameId,
  demoGameManagerId,
  demoIdentityId,
  demoParticipationId,
  demoParticipationTransitionId,
  demoPublicPlayerId,
  demoTrainerId,
  demoUserId,
  demoVenueId,
} from "./demo-ids";
import { DIRECTORY_CONSENT_POLICY_VERSION } from "../profiles/constants";

export type DemoSeedMode = "foundation" | "full";

export type DemoPerson = {
  ordinal: number;
  userId: string;
  identityId: string;
  publicPlayerId: string;
  displayName: string;
  providerKey: "vk" | "yandex";
  subject: string;
  email: string;
  directoryVisible: boolean;
  socialEligible: boolean;
  /** Directory-visible social-eligible people default to requests for DM screens. */
  contactPolicy: "requests" | "closed";
  /** Catalog city for profile/looking when present. */
  cityId: string | null;
  areaKey: string | null;
  levelId: string | null;
  bio: string | null;
  lookingActive: boolean;
  lookingFormats: string[];
  isTrainer: boolean;
  trainerId: string | null;
};

export type DemoVenue = {
  id: string;
  cityId: string;
  name: string;
  address: string;
  timezone: string;
  latitude: number;
  longitude: number;
  createdByOrdinal: number;
};

export type DemoParticipation = {
  id: string;
  transitionId: string;
  userOrdinal: number;
  status: "pending" | "confirmed" | "withdrawn";
};

export type DemoGame = {
  id: string;
  ownerManagerId: string;
  coManagerId: string | null;
  creatorOrdinal: number;
  coManagerOrdinal: number | null;
  venueOrdinal: number;
  title: string;
  status: "draft" | "published" | "cancelled";
  visibility: "public" | "unlisted";
  activityKind: "regular" | "trainer_led";
  capacity: number;
  externalReservedCount: number;
  formatKey: string;
  allowedLevelIds: string[];
  dayOffset: number;
  participations: DemoParticipation[];
};

const DISPLAY_NAMES = [
  "Alexey Morozov",
  "Maria Kovaleva",
  "Ivan Sokolov",
  "Anna Belova",
  "Dmitry Lebedev",
  "Olga Voronova",
  "Sergey Fomin",
  "Ekaterina Orlova",
  "Maxim Krylov",
  "Daria Romanova",
  "Artem Volkov",
  "Polina Nikitina",
  "Nikolay Gromov",
  "Alina Safina",
  "Andrey Titov",
  "Sofia Medvedeva",
  "Kirill Panov",
  "Victoria Ershova",
  "Roman Kuznetsov",
  "Elena Mironova",
] as const;

const MOSCOW_AREA_KEYS = [
  "sokol",
  "presnya",
  "taganka",
  "izmailovo",
  "khamovniki",
  "marino",
  "vnukovo-area",
  "mitino",
] as const;

const SPB_AREA_KEYS = [
  "vasileostrovsky",
  "petrogradsky",
  "nevsky",
  "moskovsky-raion",
] as const;

const LEVELS = ["2.5", "3.0", "3.5", "4.0", "4.5"] as const;

/**
 * City assignment (DERIVED_FOR_INTERNAL_MVP):
 * - Moscow home city: ordinals 1–10, 17, 19
 * - SPB home city: ordinals 11–16, 20
 * - ordinal 18 stays incomplete (no city) for social-ineligible variety
 * Looking: 1–6 Moscow + 11–12 SPB (8 total, ≥6).
 */
function personCityId(ordinal: number): string | null {
  if (ordinal === 18) return null;
  if (ordinal <= 10 || ordinal === 17 || ordinal === 19) {
    return DEMO_MOSCOW_CITY_ID;
  }
  return DEMO_SPB_CITY_ID;
}

function personAreaKey(ordinal: number, cityId: string | null): string | null {
  if (!cityId) return null;
  if (cityId === DEMO_SPB_CITY_ID) {
    return SPB_AREA_KEYS[(ordinal - 1) % SPB_AREA_KEYS.length]!;
  }
  return MOSCOW_AREA_KEYS[(ordinal - 1) % MOSCOW_AREA_KEYS.length]!;
}

/** Exactly 20 fictional people from SYNTHETIC_DEMO_POPULATION_V001. */
export function buildDemoPeople(): DemoPerson[] {
  return DISPLAY_NAMES.map((displayName, idx) => {
    const ordinal = idx + 1;
    const directoryVisible = ordinal <= 16; // 16 visible, 4 private/incomplete
    const lookingActive = ordinal <= 6 || ordinal === 11 || ordinal === 12;
    const isTrainer = ordinal === 1 || ordinal === 5;
    const socialEligible = ordinal !== 18; // one ineligible for variety
    // 1–14 open for DM requests; 15–16 directory-visible but closed; private stay closed.
    const contactPolicy: "requests" | "closed" =
      directoryVisible && socialEligible && ordinal <= 14 ? "requests" : "closed";
    const levelId = directoryVisible
      ? LEVELS[(ordinal - 1) % LEVELS.length]!
      : null;
    // Private 17/19/20 keep city for bio context; 18 incomplete (no city).
    const resolvedCity =
      ordinal === 18
        ? null
        : directoryVisible || ordinal === 17 || ordinal === 19 || ordinal === 20
          ? personCityId(ordinal)
          : null;
    const areaKey =
      directoryVisible && resolvedCity
        ? personAreaKey(ordinal, resolvedCity)
        : null;
    const cityLabel =
      resolvedCity === DEMO_SPB_CITY_ID ? "Saint Petersburg" : "Moscow";
    return {
      ordinal,
      userId: demoUserId(ordinal),
      identityId: demoIdentityId(ordinal),
      publicPlayerId: demoPublicPlayerId(ordinal),
      displayName,
      providerKey: ordinal % 2 === 1 ? "vk" : "yandex",
      subject: `demo-person-${String(ordinal).padStart(2, "0")}`,
      email: `demo.person${String(ordinal).padStart(2, "0")}@synthetic.gobadminton.local`,
      directoryVisible,
      socialEligible,
      contactPolicy,
      cityId: resolvedCity,
      areaKey,
      levelId,
      bio: directoryVisible
        ? `Synthetic demo player #${ordinal}. Looking for friendly doubles near ${cityLabel}.`
        : ordinal === 17 || ordinal === 20
          ? "Private synthetic profile (directory off)."
          : null,
      lookingActive,
      lookingFormats: lookingActive
        ? ordinal % 2 === 0
          ? ["doubles", "singles"]
          : ["doubles"]
        : [],
      isTrainer,
      trainerId: isTrainer ? demoTrainerId(ordinal) : null,
    };
  });
}

export function buildDemoVenues(): DemoVenue[] {
  return [
    {
      id: demoVenueId(1),
      cityId: DEMO_MOSCOW_CITY_ID,
      name: "Demo Court Sokol",
      address: "Synthetic Moscow area · Sokol (demo)",
      timezone: "Europe/Moscow",
      latitude: 55.805,
      longitude: 37.515,
      createdByOrdinal: 1,
    },
    {
      id: demoVenueId(2),
      cityId: DEMO_MOSCOW_CITY_ID,
      name: "Demo Hall Presnya",
      address: "Synthetic Moscow area · Presnya (demo)",
      timezone: "Europe/Moscow",
      latitude: 55.76,
      longitude: 37.57,
      createdByOrdinal: 2,
    },
    {
      id: demoVenueId(3),
      cityId: DEMO_MOSCOW_CITY_ID,
      name: "Demo Center Taganka",
      address: "Synthetic Moscow area · Taganka (demo)",
      timezone: "Europe/Moscow",
      latitude: 55.741,
      longitude: 37.653,
      createdByOrdinal: 3,
    },
    {
      id: demoVenueId(4),
      cityId: DEMO_MOSCOW_CITY_ID,
      name: "Demo Arena Izmailovo",
      address: "Synthetic Moscow area · Izmailovo (demo)",
      timezone: "Europe/Moscow",
      latitude: 55.788,
      longitude: 37.748,
      createdByOrdinal: 5,
    },
    {
      id: demoVenueId(5),
      cityId: DEMO_SPB_CITY_ID,
      name: "Demo Court Vasileostrovsky",
      address: "Synthetic Saint Petersburg area · Vasileostrovsky (demo)",
      timezone: "Europe/Moscow",
      latitude: 59.94,
      longitude: 30.27,
      createdByOrdinal: 11,
    },
    {
      id: demoVenueId(6),
      cityId: DEMO_SPB_CITY_ID,
      name: "Demo Hall Petrogradsky",
      address: "Synthetic Saint Petersburg area · Petrogradsky (demo)",
      timezone: "Europe/Moscow",
      latitude: 59.966,
      longitude: 30.311,
      createdByOrdinal: 12,
    },
  ];
}

function p(
  id: number,
  userOrdinal: number,
  status: DemoParticipation["status"],
): DemoParticipation {
  return {
    id: demoParticipationId(id),
    transitionId: demoParticipationTransitionId(id),
    userOrdinal,
    status,
  };
}

/**
 * Exactly 20 games across Moscow + SPB.
 * Moscow venues 1–4 / SPB venues 5–6. Includes regular + trainer_led,
 * draft/unlisted/cancelled representatives, and capacity-honest participations.
 */
export function buildDemoGames(): DemoGame[] {
  return [
    {
      id: demoGameId(1),
      ownerManagerId: demoGameManagerId(1),
      coManagerId: demoGameManagerId(101),
      creatorOrdinal: 1,
      coManagerOrdinal: 2,
      venueOrdinal: 1,
      title: "Demo Friday Doubles",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 8,
      externalReservedCount: 1,
      formatKey: "doubles",
      allowedLevelIds: ["3.0", "3.5"],
      dayOffset: 21,
      participations: [
        p(1, 3, "confirmed"),
        p(2, 4, "confirmed"),
        p(3, 9, "pending"),
        p(4, 10, "withdrawn"),
      ],
    },
    {
      id: demoGameId(2),
      ownerManagerId: demoGameManagerId(2),
      coManagerId: null,
      creatorOrdinal: 2,
      coManagerOrdinal: null,
      venueOrdinal: 2,
      title: "Demo Saturday Morning",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 6,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["2.5", "3.0"],
      dayOffset: 22,
      participations: [p(5, 6, "confirmed"), p(6, 11, "pending")],
    },
    {
      id: demoGameId(3),
      ownerManagerId: demoGameManagerId(3),
      coManagerId: null,
      creatorOrdinal: 3,
      coManagerOrdinal: null,
      venueOrdinal: 3,
      title: "Demo Beginner Mix",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 8,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["2.5", "3.0"],
      dayOffset: 23,
      participations: [
        p(7, 7, "confirmed"),
        p(8, 12, "confirmed"),
        p(9, 13, "confirmed"),
      ],
    },
    {
      id: demoGameId(4),
      ownerManagerId: demoGameManagerId(4),
      coManagerId: demoGameManagerId(104),
      creatorOrdinal: 4,
      coManagerOrdinal: 6,
      venueOrdinal: 1,
      title: "Demo Evening Rally",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 4,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["3.5", "4.0"],
      dayOffset: 24,
      participations: [p(10, 8, "confirmed"), p(11, 14, "pending")],
    },
    {
      id: demoGameId(5),
      ownerManagerId: demoGameManagerId(5),
      coManagerId: null,
      creatorOrdinal: 5,
      coManagerOrdinal: null,
      venueOrdinal: 4,
      title: "Demo Trainer Clinic",
      status: "published",
      visibility: "public",
      activityKind: "trainer_led",
      capacity: 6,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["3.0", "3.5", "4.0"],
      dayOffset: 25,
      participations: [
        p(12, 2, "confirmed"),
        p(13, 3, "confirmed"),
        p(14, 15, "pending"),
      ],
    },
    {
      id: demoGameId(6),
      ownerManagerId: demoGameManagerId(6),
      coManagerId: null,
      creatorOrdinal: 6,
      coManagerOrdinal: null,
      venueOrdinal: 5,
      title: "Demo SPB Midweek Singles",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 4,
      externalReservedCount: 1,
      formatKey: "singles",
      allowedLevelIds: ["3.5", "4.0"],
      dayOffset: 26,
      participations: [p(15, 11, "confirmed"), p(16, 16, "withdrawn")],
    },
    {
      id: demoGameId(7),
      ownerManagerId: demoGameManagerId(7),
      coManagerId: null,
      creatorOrdinal: 7,
      coManagerOrdinal: null,
      venueOrdinal: 3,
      title: "Demo Community Open",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 12,
      externalReservedCount: 2,
      formatKey: "doubles",
      allowedLevelIds: ["2.5", "3.0", "3.5"],
      dayOffset: 27,
      participations: [
        p(17, 1, "confirmed"),
        p(18, 8, "confirmed"),
        p(19, 9, "confirmed"),
        p(20, 11, "pending"),
      ],
    },
    {
      id: demoGameId(8),
      ownerManagerId: demoGameManagerId(8),
      coManagerId: null,
      creatorOrdinal: 8,
      coManagerOrdinal: null,
      venueOrdinal: 6,
      title: "Demo SPB Advanced Doubles",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 8,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["4.0", "4.5"],
      dayOffset: 28,
      participations: [p(21, 5, "confirmed"), p(22, 12, "confirmed")],
    },
    {
      id: demoGameId(9),
      ownerManagerId: demoGameManagerId(9),
      coManagerId: null,
      creatorOrdinal: 1,
      coManagerOrdinal: null,
      venueOrdinal: 4,
      title: "Demo Morozov Coaching Hour",
      status: "published",
      visibility: "public",
      activityKind: "trainer_led",
      capacity: 4,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["3.0", "3.5"],
      dayOffset: 29,
      participations: [p(23, 6, "confirmed"), p(24, 13, "pending")],
    },
    {
      id: demoGameId(10),
      ownerManagerId: demoGameManagerId(10),
      coManagerId: null,
      creatorOrdinal: 3,
      coManagerOrdinal: null,
      venueOrdinal: 5,
      title: "Demo SPB Unlisted Friends Set",
      status: "published",
      visibility: "unlisted",
      activityKind: "regular",
      capacity: 4,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["3.0", "3.5"],
      dayOffset: 30,
      participations: [p(25, 14, "confirmed"), p(26, 15, "confirmed")],
    },
    {
      id: demoGameId(11),
      ownerManagerId: demoGameManagerId(11),
      coManagerId: null,
      creatorOrdinal: 4,
      coManagerOrdinal: null,
      venueOrdinal: 3,
      title: "Demo Nearly Full Court",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 4,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["3.0", "3.5"],
      dayOffset: 31,
      participations: [
        p(27, 2, "confirmed"),
        p(28, 5, "confirmed"),
        p(29, 6, "confirmed"),
        p(30, 14, "pending"),
      ],
    },
    {
      id: demoGameId(12),
      ownerManagerId: demoGameManagerId(12),
      coManagerId: null,
      creatorOrdinal: 2,
      coManagerOrdinal: null,
      venueOrdinal: 1,
      title: "Demo Cancelled Weather",
      status: "cancelled",
      visibility: "public",
      activityKind: "regular",
      capacity: 8,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["2.5", "3.0"],
      dayOffset: 32,
      participations: [p(31, 9, "withdrawn")],
    },
    {
      id: demoGameId(13),
      ownerManagerId: demoGameManagerId(13),
      coManagerId: null,
      creatorOrdinal: 6,
      coManagerOrdinal: null,
      venueOrdinal: 4,
      title: "Demo Draft Planning Board",
      status: "draft",
      visibility: "unlisted",
      activityKind: "regular",
      capacity: 8,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["3.0", "3.5"],
      dayOffset: 33,
      participations: [],
    },
    {
      id: demoGameId(14),
      ownerManagerId: demoGameManagerId(14),
      coManagerId: null,
      creatorOrdinal: 7,
      coManagerOrdinal: null,
      venueOrdinal: 2,
      title: "Demo Sunday Social",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 10,
      externalReservedCount: 1,
      formatKey: "doubles",
      allowedLevelIds: ["2.5", "3.0", "3.5", "4.0"],
      dayOffset: 34,
      participations: [
        p(32, 10, "confirmed"),
        p(33, 15, "confirmed"),
        p(34, 16, "pending"),
      ],
    },
    {
      id: demoGameId(15),
      ownerManagerId: demoGameManagerId(15),
      coManagerId: null,
      creatorOrdinal: 11,
      coManagerOrdinal: null,
      venueOrdinal: 5,
      title: "Demo SPB Neva Doubles",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 8,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["3.0", "3.5"],
      dayOffset: 35,
      participations: [
        p(35, 12, "confirmed"),
        p(36, 13, "confirmed"),
        p(37, 14, "pending"),
      ],
    },
    {
      id: demoGameId(16),
      ownerManagerId: demoGameManagerId(16),
      coManagerId: demoGameManagerId(116),
      creatorOrdinal: 12,
      coManagerOrdinal: 13,
      venueOrdinal: 6,
      title: "Demo SPB Petrograd Mix",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 6,
      externalReservedCount: 1,
      formatKey: "doubles",
      allowedLevelIds: ["2.5", "3.0", "3.5"],
      dayOffset: 36,
      participations: [p(38, 11, "confirmed"), p(39, 15, "pending")],
    },
    {
      id: demoGameId(17),
      ownerManagerId: demoGameManagerId(17),
      coManagerId: null,
      creatorOrdinal: 5,
      coManagerOrdinal: null,
      venueOrdinal: 6,
      title: "Demo SPB Trainer Clinic",
      status: "published",
      visibility: "public",
      activityKind: "trainer_led",
      capacity: 6,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["3.0", "3.5", "4.0"],
      dayOffset: 37,
      participations: [
        p(40, 11, "confirmed"),
        p(41, 12, "confirmed"),
        p(42, 16, "withdrawn"),
      ],
    },
    {
      id: demoGameId(18),
      ownerManagerId: demoGameManagerId(18),
      coManagerId: null,
      creatorOrdinal: 14,
      coManagerOrdinal: null,
      venueOrdinal: 5,
      title: "Demo SPB Evening Rally",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 4,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["3.5", "4.0"],
      dayOffset: 38,
      participations: [p(43, 13, "confirmed"), p(44, 15, "confirmed")],
    },
    {
      id: demoGameId(19),
      ownerManagerId: demoGameManagerId(19),
      coManagerId: null,
      creatorOrdinal: 15,
      coManagerOrdinal: null,
      venueOrdinal: 6,
      title: "Demo SPB Community Open",
      status: "published",
      visibility: "public",
      activityKind: "regular",
      capacity: 10,
      externalReservedCount: 2,
      formatKey: "doubles",
      allowedLevelIds: ["2.5", "3.0", "3.5"],
      dayOffset: 39,
      participations: [
        p(45, 11, "confirmed"),
        p(46, 12, "confirmed"),
        p(47, 14, "pending"),
      ],
    },
    {
      id: demoGameId(20),
      ownerManagerId: demoGameManagerId(20),
      coManagerId: null,
      creatorOrdinal: 16,
      coManagerOrdinal: null,
      venueOrdinal: 5,
      title: "Demo SPB Cancelled Flood",
      status: "cancelled",
      visibility: "public",
      activityKind: "regular",
      capacity: 8,
      externalReservedCount: 0,
      formatKey: "doubles",
      allowedLevelIds: ["2.5", "3.0"],
      dayOffset: 40,
      participations: [p(48, 13, "withdrawn")],
    },
  ];
}

export const DEMO_CONSENT_POLICY_VERSION = DIRECTORY_CONSENT_POLICY_VERSION;
export {
  DEMO_CITY_ID,
  DEMO_ISSUER_NAMESPACE,
  DEMO_MOSCOW_CITY_ID,
  DEMO_SPB_CITY_ID,
};
