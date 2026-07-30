"use client";

import {
  IconLayoutList,
  IconLink,
  IconLoader2,
  IconPalette,
  IconQrcode,
} from "@tabler/icons-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/trpc/react";

import type { RouterOutputs } from "@/trpc/shared";

type UsageRef = RouterOutputs["asset"]["usage"][number];

const KIND_META: Record<UsageRef["kind"], { icon: typeof IconLink; label: string }> = {
  link: { icon: IconLink, label: "Link" },
  "qr-code": { icon: IconQrcode, label: "QR code" },
  "qr-preset": { icon: IconPalette, label: "QR preset" },
  "template-page": { icon: IconLayoutList, label: "Page" },
};

type Props = {
  assetId: number | null;
  assetName: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/**
 * Confirm removing an image from the library, showing what still points at it.
 *
 * The list is the whole point: removing an asset never breaks those references,
 * and seeing them is what makes that believable rather than surprising.
 */
export function AssetUsageDialog({ assetId, assetName, onOpenChange, onConfirm }: Props) {
  const usage = api.asset.usage.useQuery(
    { id: assetId ?? 0 },
    { enabled: assetId !== null, refetchOnWindowFocus: false },
  );

  const refs = usage.data ?? [];

  return (
    <AlertDialog open={assetId !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove “{assetName}” from your assets?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                It disappears from your library and from the image picker. Anything already using it
                keeps working — the image itself stays stored, so published pages and printed QR
                codes are unaffected.
              </p>

              {usage.isLoading ? (
                <span className="flex items-center gap-2 text-[13px] text-neutral-400">
                  <IconLoader2 size={14} className="animate-spin" /> Checking where it's used…
                </span>
              ) : refs.length === 0 ? (
                <p className="text-[13px] text-neutral-400 dark:text-neutral-500">
                  Nothing is using it right now, so you'll be able to delete it permanently from the
                  trash.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-neutral-400">
                    Currently used by {refs.length} {refs.length === 1 ? "item" : "items"}
                  </p>
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {refs.map((ref) => {
                      const meta = KIND_META[ref.kind];
                      const Icon = meta.icon;
                      return (
                        <li
                          key={`${ref.kind}-${ref.id}`}
                          className="flex items-center gap-2 text-[13px] text-neutral-600 dark:text-neutral-300"
                        >
                          <Icon size={14} stroke={1.5} className="shrink-0 text-neutral-400" />
                          <span className="truncate">{ref.label}</span>
                          <span className="shrink-0 text-[11px] text-neutral-400">
                            {meta.label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Remove from assets</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
