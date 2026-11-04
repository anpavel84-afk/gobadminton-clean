export type PilotMetricsCity = {
  id: string;
  nameRu: string;
};

export type PilotMetricsResponse = {
  city: PilotMetricsCity | null;
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
    currentStatus: {
      pending: number;
      confirmed: number;
      withdrawn: number;
      rejected: number;
      removed: number;
      expired: number;
    };
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
  cities: PilotMetricsCity[];
};
