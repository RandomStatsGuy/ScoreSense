import React from "react";

/**
 * Shared button primitive over the global button classes.
 * variant: "primary" | "ghost" | "danger" | "link"
 * size: "md" | "sm"
 */
const VARIANT_CLASS = {
  primary: "btn-primary",
  ghost: "btn-ghost",
  danger: "btn-danger",
  link: "btn-link",
};

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  children,
  ...rest
}) {
  const variantClass = VARIANT_CLASS[variant] || VARIANT_CLASS.primary;
  const sizeClass = size === "sm" ? "btn-sm" : "";
  const classes = [variantClass, sizeClass, className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
