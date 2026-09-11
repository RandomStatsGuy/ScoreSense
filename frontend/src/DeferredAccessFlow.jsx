import React, { useEffect, useState } from "react";

// Preserve the existing success/dismiss state after a flow removes its URL token.
export default function DeferredAccessFlow({ active, children }) {
  const [opened, setOpened] = useState(active);
  useEffect(() => {
    if (active) setOpened(true);
  }, [active]);
  return active || opened ? children : null;
}
