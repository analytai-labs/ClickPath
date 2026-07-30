"use client";

import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useState } from "react";

/** Copies the page's canonical public URL — the same string the QR code encodes. */
export function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label="Copy public URL"
      title={copied ? "Copied" : "Copy public URL"}
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => setCopied(true));
      }}
      className="shrink-0 rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-muted dark:hover:text-foreground"
    >
      {copied ? (
        <IconCheck size={13} stroke={2} className="text-emerald-600" />
      ) : (
        <IconCopy size={13} stroke={1.5} />
      )}
    </button>
  );
}
