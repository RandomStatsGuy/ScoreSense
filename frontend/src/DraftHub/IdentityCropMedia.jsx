import React from "react";
import { useHubMediaUrl } from "./HubMediaImg";
import { focusCssVars } from "./atmosphereCatalog";

export default function IdentityCropMedia({
  src,
  focus,
  alt = "",
  className = "",
  width,
}) {
  const isLocal = Boolean(src && (src.startsWith("blob:") || src.startsWith("data:")));
  const remote = useHubMediaUrl(isLocal ? "" : src, { width });
  const url = isLocal ? src : remote;
  if (!url) return null;
  return (
    <img
      src={url}
      alt={alt}
      className={`hub-crop-img${className ? ` ${className}` : ""}`}
      style={focusCssVars(focus)}
    />
  );
}
