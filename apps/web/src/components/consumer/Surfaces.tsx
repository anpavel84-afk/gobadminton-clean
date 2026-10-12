import type { HTMLAttributes, ReactNode } from "react";

type ContainerProps = HTMLAttributes<HTMLDivElement> & { measure?: "standard" | "narrow" };
export function ContentContainer({ measure = "standard", className = "", ...props }: ContainerProps) {
  return <div className={`gb-content-container gb-content-container--${measure} ${className}`} {...props} />;
}

type SurfaceProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "plain" | "bordered" | "elevated" | "soft" | "dark" | "lime" | "purple";
};
export function SurfacePanel({ tone = "bordered", className = "", ...props }: SurfaceProps) {
  return <div className={`gb-surface gb-surface--${tone} ${className}`} {...props} />;
}

/** Dedicated scroll owner leaves the local header/composer visible in focused mode. */
export function FocusedScrollArea({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`gb-focused-scroll ${className}`} {...props}>{children}</div>;
}
export function FocusedActions({ children }: { children: ReactNode }) {
  return <div className="gb-focused-actions">{children}</div>;
}
