"use client";

import { useEffect, useRef } from "react";

/**
 * Fires a single page-view beacon to /api/templates/view on mount. The endpoint
 * records the view through the same quota-aware pipeline as link clicks, for
 * every template type.
 */
export function TemplatePageViewBeacon({ templatePageId }: { templatePageId: number }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void fetch("/api/templates/view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templatePageId }),
      keepalive: true,
    }).catch(() => {});
  }, [templatePageId]);

  return null;
}
