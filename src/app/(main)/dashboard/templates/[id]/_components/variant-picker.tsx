"use client";

import { cn } from "@/lib/utils";

import type { AnyTemplateDefinition } from "@/lib/templates/registry";

/**
 * Styling-variant picker. Driven entirely by the template definition's
 * `variants`, so a new preset appears here the moment it is declared.
 */
export function VariantPicker({
  definition,
  value,
  onChange,
}: {
  definition: AnyTemplateDefinition;
  value: string;
  onChange: (variantId: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {definition.variants.map((variant) => {
        const selected = value === variant.id;
        return (
          <button
            key={variant.id}
            type="button"
            onClick={() => onChange(variant.id)}
            aria-pressed={selected}
            className={cn(
              "flex h-[68px] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border text-[11px] font-medium transition-all",
              selected
                ? "border-blue-500 ring-1 ring-blue-500"
                : "border-neutral-200 hover:border-neutral-300 dark:border-border dark:hover:border-neutral-600",
            )}
            style={{ background: variant.swatch.background, color: variant.swatch.text }}
          >
            <span
              className="h-4 w-10 rounded-full"
              style={{ background: variant.swatch.accent }}
              aria-hidden
            />
            <span className="max-w-full truncate px-1">{variant.label}</span>
          </button>
        );
      })}
    </div>
  );
}
