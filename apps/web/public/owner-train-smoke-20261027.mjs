/**
 * Owner-authorized minimal reversible DEV E2E probe.
 * Pure ES module: no imports, network, filesystem, or side effects.
 */

export function getOwnerTrainDevProbe() {
  return Object.freeze({
    schema: "GB_OWNER_TRAIN_DEV_PROBE_V1",
    environment: "dev",
    probeId: "owner-direct-20261027",
  });
}
