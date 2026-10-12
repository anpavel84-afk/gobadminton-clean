import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

/** Frozen variants + compatibility aliases used by existing pages. */
type Variant =
  | "primary"
  | "dark"
  | "outline"
  | "ghost"
  | "secondary"
  | "quiet"
  | "danger";

type Common = {
  variant?: Variant;
  block?: boolean;
  children: ReactNode;
  className?: string;
  loading?: boolean;
};

type ButtonProps = Common &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
  };

type LinkProps = Common & {
  href: string;
  disabled?: boolean;
};

function resolveVariant(variant: Variant): string {
  if (variant === "secondary") return "outline";
  if (variant === "quiet") return "ghost";
  return variant;
}

export function Button(props: ButtonProps | LinkProps) {
  const resolved = resolveVariant(props.variant ?? "primary");
  const className = [
    "gb-c23-btn",
    `gb-c23-btn--${resolved}`,
    props.block ? "gb-c23-btn--block" : "",
    props.loading ? "gb-c23-btn--loading" : "",
    props.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  if ("href" in props && props.href) {
    if (props.disabled || props.loading) {
      return (
        <span className={className} aria-disabled="true">
          {props.children}
        </span>
      );
    }
    return (
      <Link href={props.href} className={className}>
        {props.children}
      </Link>
    );
  }

  return <NativeButton {...props as ButtonProps} className={className} />;
}

function NativeButton({
  variant: _variant, block: _block, loading, className, children, href: _href, ...buttonProps
}: ButtonProps) {
  return (
    <button
      {...buttonProps}
      type={buttonProps.type ?? "button"}
      className={className}
      disabled={buttonProps.disabled || loading}
      aria-busy={loading || buttonProps["aria-busy"]}
    >
      {children}
    </button>
  );
}
