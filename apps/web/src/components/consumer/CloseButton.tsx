import type { ComponentPropsWithRef } from "react";

export type CloseButtonProps = Omit<ComponentPropsWithRef<"button">,
  "type" | "children" | "dangerouslySetInnerHTML" | "aria-label"> & {
  type?: never;
  children?: never;
  dangerouslySetInnerHTML?: never;
  /** Close or collapse dismissals share the X control; labels stay in these two families. */
  "aria-label"?: `Закрыть${string}` | `Свернуть${string}`;
};

/** Shared close control. The caller owns placement and all dismissal guards. */
export function CloseButton({ className, "aria-label": label = "Закрыть", ref, ...props }: CloseButtonProps) {
  return <button {...props} ref={ref} type="button" aria-label={label} className={`gb-close-button${className ? ` ${className}` : ""}`}>
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1={6} y1={6} x2={18} y2={18} />
      <line x1={18} y1={6} x2={6} y2={18} />
    </svg>
  </button>;
}
