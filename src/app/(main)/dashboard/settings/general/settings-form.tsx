"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconCheck, IconLoader2, IconWorld } from "@tabler/icons-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_PLATFORM_DOMAIN,
  PLATFORM_DOMAINS,
  isPlatformDomain,
} from "@/lib/constants/domains";
import { api } from "@/trpc/react";

import type { RouterOutputs } from "@/trpc/shared";

const formSchema = z.object({
  defaultDomain: z.string(),
});

type SettingsFormProps = {
  userSettings: RouterOutputs["siteSettings"]["get"];
  availableDomains: RouterOutputs["customDomain"]["list"];
};

export function SettingsForm({ userSettings, availableDomains }: SettingsFormProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const utils = api.useUtils();

  const currentDefaultDomain = userSettings?.defaultDomain || DEFAULT_PLATFORM_DOMAIN;
  const isTeamDefault = userSettings?.defaultDomainScope === "team";
  const canEdit = userSettings?.canEditDefaultDomain ?? true;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      defaultDomain: currentDefaultDomain,
    },
  });

  const { mutate: updateSettings } = api.siteSettings.update.useMutation({
    onSuccess: async (_, variables) => {
      form.reset(variables);
      setIsSaving(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      await Promise.all([
        utils.siteSettings.get.invalidate(),
        utils.link.defaultDomain.invalidate(),
      ]);
      toast.success("Settings updated");
    },
    onError: (error) => {
      setIsSaving(false);
      toast.error(error.message);
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSaving(true);
    updateSettings(values);
  }

  const activeDomains = [
    ...PLATFORM_DOMAINS.map((domain) => ({ domain, status: "active" as const })),
    ...availableDomains.filter((d) => d.status === "active"),
    ...(currentDefaultDomain &&
    !isPlatformDomain(currentDefaultDomain) &&
    !availableDomains.some((d) => d.domain === currentDefaultDomain)
      ? [{ domain: currentDefaultDomain, status: "active" as const }]
      : []),
  ];

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-border p-5">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="defaultDomain"
            render={({ field }) => (
              <FormItem>
                <label className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                  {isTeamDefault ? "Team Default Domain" : "Default Domain"}
                </label>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  disabled={!canEdit}
                >
                  <FormControl>
                    <SelectTrigger className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px]">
                      <SelectValue placeholder="Select a domain" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {activeDomains.map((domain) => (
                      <SelectItem
                        key={domain.domain}
                        value={domain.domain!}
                        className="text-[13px]"
                      >
                        <div className="flex items-center gap-2">
                          <IconWorld
                            size={14}
                            stroke={1.5}
                            className="text-neutral-400 dark:text-neutral-500"
                          />
                          <span>{domain.domain}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                  {isTeamDefault
                    ? canEdit
                      ? "Default for new links and pages in this team."
                      : "The team's default for new links and pages. Only team owners and admins can change it."
                    : "Used when creating quick shortened links."}{" "}
                  <a
                    href="/dashboard/domains"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Manage domains
                  </a>
                </p>
                <FormMessage className="text-[11px]" />
              </FormItem>
            )}
          />

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!canEdit || isSaving || !form.formState.isDirty}
              className="h-9 bg-blue-600 text-[13px] hover:bg-blue-700"
            >
              {isSaving ? (
                <>
                  <IconLoader2 size={14} stroke={1.5} className="mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : justSaved ? (
                <>
                  <IconCheck size={14} stroke={1.5} className="mr-1.5" />
                  Saved
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
