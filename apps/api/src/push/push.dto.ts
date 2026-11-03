export type PushDeviceDto = {
  id: string;
  current: boolean;
  createdAt: string;
};

export type PushStateDto = {
  featureAvailable: boolean;
  preferenceEnabled: boolean;
  preferenceVersion: number;
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
};

export type PushRegisterBody = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

export type PushPreferenceResultDto = {
  preferenceEnabled: boolean;
  preferenceVersion: number;
};

export type PushRegisterResultDto = {
  id: string;
  accountFence: string;
  deviceCount: number;
};
