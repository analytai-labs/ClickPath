"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_TEMPLATE_PATH_PREFIX,
  TEMPLATE_PATH_PREFIXES,
  type TemplatePathPrefix,
  isTemplatePathPrefix,
} from "@/lib/templates/page-url";

/** A stored prefix as a select value, falling back to the default for unknown values. */
export function toPathPrefix(value: string | null | undefined): TemplatePathPrefix {
  return isTemplatePathPrefix(value) ? value : DEFAULT_TEMPLATE_PATH_PREFIX;
}

/**
 * The page URL's first path segment. Only the default is available on the
 * platform domain, so the select is disabled until a custom domain is chosen.
 */
export function PathPrefixSelect({
  value,
  onChange,
  hasCustomDomain,
  id,
}: {
  value: TemplatePathPrefix;
  onChange: (value: TemplatePathPrefix) => void;
  hasCustomDomain: boolean;
  id?: string;
}) {
  return (
    <Select
      value={hasCustomDomain ? value : DEFAULT_TEMPLATE_PATH_PREFIX}
      onValueChange={(v) => onChange(toPathPrefix(v))}
      disabled={!hasCustomDomain}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TEMPLATE_PATH_PREFIXES.map((prefix) => (
          <SelectItem key={prefix} value={prefix}>
            /{prefix}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
