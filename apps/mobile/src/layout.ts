/** Logical dp only. Insets belong to the frame; measured viewport is below chrome. */
export type SafeEdges = { top: number; right: number; bottom: number; left: number };
export function contentWidth(width: number, insets: SafeEdges, gutter: number) {
  return Math.max(0, width - insets.left - insets.right - gutter * 2);
}
export function introArtworkSize({ width, viewportHeight, copyHeight, actionsHeight, fontScale }: {
  width: number; viewportHeight: number; copyHeight: number; actionsHeight: number; fontScale: number;
}) {
  // 16 top/bottom padding, 6 progress, three 12dp group gaps, 24 orbit clearance.
  // Text/actions are measured at the user's font scale; never scale the screen/text.
  const remaining = viewportHeight - copyHeight - actionsHeight - 32 - 6 - 36 - 24;
  const preferred = viewportHeight > 760 && fontScale <= 1 ? 270 : 195;
  return Math.max(0, Math.min(preferred, width / 1.4, remaining));
}
