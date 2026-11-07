export type PushDeviceDto = {
  id: string;
  current: boolean;
  createdAt: string;
};

export type PushEventPreferencesDto = {
  invites: boolean;
  applicationDecisions: boolean;
  newApplications: boolean;
  gameChanges: boolean;
  outcomeReminders: boolean;
};

export type PushStateDto = {
  featureAvailable: boolean;
  preferenceEnabled: boolean;
  preferenceVersion: number;
  eventPreferences: PushEventPreferencesDto;
  vapidPublicKey: string | null;
  accountFence: string | null;
  deviceCount: number;
  maxDevices: number;
  currentDevice: PushDeviceDto | null;
  devices: PushDeviceDto[];
};

export type PushPreferenceBody = {
  enabled?: unknown;
  expectedVersion?: unknown;
  eventPreferences?: unknown;
};

export type PushRegisterBody = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

export type PushPreferenceResultDto = {
  preferenceEnabled: boolean;
  preferenceVersion: number;
  eventPreferences: PushEventPreferencesDto;
};

export type PushRegisterResultDto = {
  id: string;
  accountFence: string;
  deviceCount: number;
};
