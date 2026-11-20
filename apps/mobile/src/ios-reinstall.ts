import type * as ExpoFileSystemModule from 'expo-file-system';

/** Lives in the app Documents container, which iOS wipes on uninstall while Keychain items survive. */
export const IOS_INSTALL_MARKER = 'gobadminton.install-marker.v1';

export type ReinstallGuardDeps = {
  os: string;
  markerExists: () => boolean | Promise<boolean>;
  writeMarker: () => void | Promise<void>;
  deleteSession: () => Promise<void>;
};

/** Memoised once-per-process run; never rejects, and is a no-op off iOS. */
export function createReinstallGuard(deps: ReinstallGuardDeps): () => Promise<void> {
  let run: Promise<void> | undefined;
  return () => (run ??= deps.os === 'ios' ? clearSessionOnFreshInstall(deps) : Promise.resolve());
}

async function clearSessionOnFreshInstall(deps: ReinstallGuardDeps): Promise<void> {
  let present: boolean;
  // An unreadable marker counts as a fresh install: a lost session is recoverable, a restored stale one is not.
  try { present = await deps.markerExists(); } catch { present = false; }
  if (present) return;
  // Without a confirmed delete the marker stays absent so the next launch retries.
  try { await deps.deleteSession(); } catch { return; }
  try { await deps.writeMarker(); } catch { /* Unwritable marker: the next launch clears again instead of crashing. */ }
}

/** Live iOS adapter; expo-file-system is required lazily so it is only loaded when the guard actually runs. */
export function createExpoReinstallGuard(os: string, deleteSession: () => Promise<void>): () => Promise<void> {
  const marker = () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as typeof ExpoFileSystemModule;
    return new File(Paths.document, IOS_INSTALL_MARKER);
  };
  return createReinstallGuard({ os, deleteSession, markerExists: () => marker().exists, writeMarker: () => marker().write('1') });
}
