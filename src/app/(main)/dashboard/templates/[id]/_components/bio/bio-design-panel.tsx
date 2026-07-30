"use client";

import { IconLock } from "@tabler/icons-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { EditorCard, SettingRow } from "../editor-ui";
import { VariantPicker } from "../variant-picker";

import type { Plan } from "@/lib/billing/plans";
import type { AnyTemplateDefinition } from "@/lib/templates/registry";
import type { BioPageTheme } from "@/server/db/types";

const BUTTON_STYLES = [
  { value: "rounded", label: "Rounded" },
  { value: "pill", label: "Pill" },
  { value: "sharp", label: "Sharp" },
  { value: "outline", label: "Outline" },
] as const;

const FONTS = [
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Mono" },
  { value: "rounded", label: "Rounded" },
] as const;

/** Design tab for the bio page: a variant preset plus the Pro theme overrides. */
export function BioDesignPanel({
  definition,
  theme,
  plan,
  onChange,
}: {
  definition: AnyTemplateDefinition;
  theme: BioPageTheme;
  plan: Plan;
  onChange: (patch: Partial<BioPageTheme>) => void;
}) {
  const isPaid = plan !== "free";

  return (
    <>
      <EditorCard title="Style" description="Pick a preset, then fine-tune it below.">
        <VariantPicker
          definition={definition}
          value={theme.preset ?? definition.defaultVariantId}
          onChange={(preset) => onChange({ preset })}
        />
      </EditorCard>

      <EditorCard
        title="Fine-tuning"
        description={isPaid ? undefined : "Available on Pro and Ultra plans."}
      >
        <div className="space-y-5">
          <SettingRow label={<Locked isPaid={isPaid}>Accent color</Locked>}>
            <input
              type="color"
              aria-label="Accent color"
              value={theme.accentColor ?? "#0a0a0a"}
              disabled={!isPaid}
              onChange={(e) => onChange({ accentColor: e.target.value })}
              className="h-9 w-14 cursor-pointer rounded-lg border border-input bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
            />
          </SettingRow>

          <SettingRow label={<Locked isPaid={isPaid}>Button style</Locked>}>
            <Select
              value={theme.buttonStyle ?? ""}
              onValueChange={(v) => onChange({ buttonStyle: v as BioPageTheme["buttonStyle"] })}
              disabled={!isPaid}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Preset default" />
              </SelectTrigger>
              <SelectContent>
                {BUTTON_STYLES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label={<Locked isPaid={isPaid}>Font</Locked>}>
            <Select
              value={theme.font ?? ""}
              onValueChange={(v) => onChange({ font: v })}
              disabled={!isPaid}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Sans" />
              </SelectTrigger>
              <SelectContent>
                {FONTS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </div>
      </EditorCard>
    </>
  );
}

function Locked({ isPaid, children }: { isPaid: boolean; children: React.ReactNode }) {
  return (
    <>
      {children}
      {!isPaid && <IconLock size={13} className="text-amber-500" />}
    </>
  );
}
