/** Bounds around a server-published coarse center, never a raw browser fix. */
export function radarNeighborhood(center: { latitude: number; longitude: number } | undefined): [[number, number], [number, number]] | null {
  if (!center || !Number.isFinite(center.latitude) || !Number.isFinite(center.longitude) || center.latitude < 54.5 || center.latitude > 56.5 || center.longitude < 36 || center.longitude > 39.5) return null;
  const dy = 10 / 111.32, dx = dy / Math.cos(center.latitude * Math.PI / 180);
  return [[center.longitude - dx, center.latitude - dy], [center.longitude + dx, center.latitude + dy]];
}
