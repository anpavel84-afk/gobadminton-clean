export type PilotCity = { id: string; nameRu: string };

export type PilotMetrics = {
  city: PilotCity;
  window: { from: string; to: string };
  asOf: string;
  formulas: Record<string, string>;
  exclusionPolicy: {
    demoUuidNamespace: string;
    demoIssuerNamespace: string;
    draftExcluded: boolean;
    cancellationsDisclosedSeparately: boolean;
    unmarkedManualTestLimitation: string;
  };
  coverage: {
    sufficient: boolean;
    notes: string[];
    participationsWithoutAttemptProof: number;
    gamesDueInWindow: number;
  };
  games: {
    dueInWindow: number;
    publishedEligible: number;
    cancelledDisclosed: number;
    draftExcluded: number;
    demoExcluded: number;
    held: number;
    notHeld: number;
    unknownOutcome: number;
    heldRate: number | null;
  };
  applications: {
    count: number;
    confirmations: number;
    confirmationRate: number | null;
    currentStatus: Record<string, number>;
    withdrawnAttempts: number;
    rejectedAttempts: number;
    removedAttempts: number;
    expiredAttempts: number;
  };
  attendance: {
    present: number;
    absent: number;
    unknown: number;
    eligibleOnHeldGames: number;
  };
  repeatAttendance: {
    usersWithAtLeastOnePresent: number;
    usersWithRepeatPresent: number;
    rate: number | null;
  };
  organizers: {
    withEligiblePublishedGames: number;
    withHeldGames: number;
    withRepeatEligibleGames: number;
  };
  cities: PilotCity[];
};

export function formatRate(value: number | null): string {
  if (value == null) return "н/д (нет знаменателя)";
  return `${(value * 100).toFixed(1)} %`;
}

export function defaultPilotWindow(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function buildPilotMetricsPath(input: {
  cityId?: string;
  from?: string;
  to?: string;
}): string {
  const params = new URLSearchParams();
  if (input.cityId) params.set("cityId", input.cityId);
  if (input.from) {
    const fromIso = input.from.length === 10 ? `${input.from}T00:00:00.000Z` : input.from;
    params.set("from", fromIso);
  }
  if (input.to) {
    const toIso = input.to.length === 10 ? `${input.to}T00:00:00.000Z` : input.to;
    params.set("to", toIso);
  }
  const query = params.toString();
  return query ? `pilot-metrics?${query}` : "pilot-metrics";
}

export const PILOT_FILTER_LABELS = {
  city: "Город",
  from: "Начало окна (UTC)",
  to: "Конец окна (UTC, не включая)",
  submit: "Показать сводку",
} as const;
