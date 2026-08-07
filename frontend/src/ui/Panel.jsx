import React from "react";

/** Rounded, bordered surface container. Groups a distinct data set. */
export default function Panel({ as: Tag = "section", wide = false, className = "", children, ...rest }) {
  const classes = ["panel", wide ? "wide" : "", className].filter(Boolean).join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
