"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  IconCalendar,
  IconClick,
  IconLoader2,
  IconX,
  IconSettings,
  IconRoute,
  IconQrcode,
} from "@tabler/icons-react";
import { format } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

// Lazy load GeoRulesForm to reduce initial bundle size (includes framer-motion)
const GeoRulesForm = dynamic(
  () => import("@/app/(main)/dashboard/_components/geo-rules-form").then((mod) => mod.GeoRulesForm),
  { ssr: false },
);
import { MilestoneEditor } from "@/app/(main)/dashboard/_components/milestone-form";
import type { MilestoneEntry } from "@/app/(main)/dashboard/_components/milestone-form";
import { PlanBadge, SectionToggle } from "@/app/(main)/dashboard/_components/section-toggle";
import { UtmParamsForm } from "@/app/(main)/dashboard/_components/utm-params-form";
import { UtmTemplateSelector } from "@/app/(main)/dashboard/_components/utm-template-selector";
import { OgImageUploader } from "@/app/(main)/dashboard/link/new/_components/og-image-uploader";
import { revalidateHomepage } from "@/app/(main)/dashboard/revalidate-homepage";
import { QRAdvancedCustomization } from "@/app/(main)/dashboard/qrcodes/create/_components/qr-advanced-customization";
import {
  defaultGeneratorState,
  generateQRCode,
  type QRCodeGeneratorState,
} from "@/lib/qr-generator";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { POSTHOG_EVENTS, trackEvent } from "@/lib/analytics/events";
import { DEFAULT_PLATFORM_DOMAIN, PLATFORM_DOMAINS } from "@/lib/constants/domains";
import { clientLogger } from "@/lib/logger/client";
import { cn } from "@/lib/utils";
import { updateLinkSchema } from "@/server/api/routers/link/link.input";
import { api } from "@/trpc/react";
import { useDebounce } from "use-debounce";

const log = clientLogger.child({ component: "edit-link-drawer" });

import type { RouterOutputs } from "@/trpc/shared";
import type { z } from "zod";

type LinkMetadata = {
  title?: string;
  description?: string;
  image?: string;
};

type EditLinkDrawerProps = {
  link: RouterOutputs["link"]["list"]["links"][number] & {
    qrCode?: {
      id?: number;
      title?: string | null;
      patternStyle?: string | null;
      cornerStyle?: string | null;
      selectedColor?: string | null;
    } | null;
  };
  open: boolean;
  onClose: () => void;
  initialTab?: "settings" | "routing" | "qr";
};

export function EditLinkDrawer({ link, open, onClose, initialTab }: EditLinkDrawerProps) {
  const [tags, setTags] = useState<string[]>((link.tags as string[]) || []);
  const [tagInput, setTagInput] = useState("");
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [isCustomMetadataOpen, setIsCustomMetadataOpen] = useState(false);
  const [isUtmParamsOpen, setIsUtmParamsOpen] = useState(false);
  const [isOptionalSettingsOpen, setIsOptionalSettingsOpen] = useState(false);
  const [isLinkCloakingOpen, setIsLinkCloakingOpen] = useState(false);
  const [isCheckingIframeable, setIsCheckingIframeable] = useState(false);
  const [iframeableResult, setIframeableResult] = useState<boolean | null>(null);
  const [isVerifiedClicksOpen, setIsVerifiedClicksOpen] = useState(false);
  const [isMilestonesOpen, setIsMilestonesOpen] = useState(false);
  const [milestones, setMilestones] = useState<MilestoneEntry[]>([]);

  const [activeTab, setActiveTab] = useState<"settings" | "routing" | "qr">(
    initialTab || "settings",
  );
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab || "settings");
    }
  }, [open, initialTab]);

  const [qrState, setQrState] = useState<QRCodeGeneratorState>(() => {
    const base = defaultGeneratorState();
    if (link.qrCode) {
      if (link.qrCode.patternStyle) base.pixelStyle = link.qrCode.patternStyle as any;
      if (link.qrCode.cornerStyle) base.markerShape = link.qrCode.cornerStyle as any;
      if (link.qrCode.selectedColor) base.darkColor = link.qrCode.selectedColor;
      if (link.qrCode.lightColor) base.lightColor = link.qrCode.lightColor;
      if (link.qrCode.logoImage) base.logoImage = link.qrCode.logoImage;
      if (link.qrCode.effect) base.effect = link.qrCode.effect as any;
      if (link.qrCode.marginNoise !== undefined) base.marginNoise = link.qrCode.marginNoise;
      if (link.qrCode.markerInnerShape) base.markerInnerShape = link.qrCode.markerInnerShape as any;
    }
    return base;
  });
  const [qrCodeTitle, setQrCodeTitle] = useState(link.qrCode?.title ?? "");

  useEffect(() => {
    if (open) {
      setQrCodeTitle(link.qrCode?.title ?? "");
      const base = defaultGeneratorState();
      if (link.qrCode) {
        if (link.qrCode.patternStyle) base.pixelStyle = link.qrCode.patternStyle as any;
        if (link.qrCode.cornerStyle) base.markerShape = link.qrCode.cornerStyle as any;
        if (link.qrCode.selectedColor) base.darkColor = link.qrCode.selectedColor;
        if (link.qrCode.lightColor) base.lightColor = link.qrCode.lightColor;
        if (link.qrCode.logoImage) base.logoImage = link.qrCode.logoImage;
        if (link.qrCode.effect) base.effect = link.qrCode.effect as any;
        if (link.qrCode.marginNoise !== undefined) base.marginNoise = link.qrCode.marginNoise;
        if (link.qrCode.markerInnerShape) base.markerInnerShape = link.qrCode.markerInnerShape as any;
      }
      setQrState(base);
    }
  }, [open, link]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const updateQrState = useCallback((updates: Partial<QRCodeGeneratorState>) => {
    setQrState((prev: QRCodeGeneratorState) => ({ ...prev, ...updates }));
  }, []);

  const qrCodeSaveImageMutation = api.qrCode.saveImage.useMutation();

  const renderQRCode = useCallback(async () => {
    if (!canvasRef.current) return;
    const dest = link.url || `https://${link.domain}/${link.alias}`;
    try {
      await generateQRCode(canvasRef.current, {
        ...qrState,
        text: dest,
        scale: 10,
        margin: 2,
      });
    } catch (e) {
      log.error({ err: e }, "failed to render QR code inside EditLinkDrawer");
    }
  }, [qrState, link.url, link.domain, link.alias]);

  useEffect(() => {
    if (open && activeTab === "qr") {
      const timer = setTimeout(renderQRCode, 50);
      return () => clearTimeout(timer);
    }
  }, [open, activeTab, renderQRCode]);

  const { data: userTags } = api.tag.list.useQuery();
  const userSubscription = api.subscriptions.get.useQuery();
  const { data: existingGeoRules } = api.geoRules.getByLinkId.useQuery(
    { linkId: link.id },
    { enabled: open },
  );
  const { data: existingMilestones } = api.linkMilestone.getByLinkId.useQuery(
    { linkId: link.id },
    { enabled: open },
  );

  const formUpdateMutation = api.link.update.useMutation({
    onSuccess: async () => {
      await revalidateHomepage();
    },
  });
  const milestoneUpsertMutation = api.linkMilestone.upsert.useMutation();

  const getFormDefaults = (linkData: typeof link, geoRules?: typeof existingGeoRules) => {
    const metadata = linkData.metadata as LinkMetadata | undefined;
    return {
      id: linkData.id,
      name: linkData.name ?? "",
      url: linkData.url ?? "",
      alias: linkData.alias ?? "",
      note: linkData.note ?? undefined,
      disableLinkAfterClicks: linkData.disableLinkAfterClicks ?? undefined,
      disableLinkAfterDate: linkData.disableLinkAfterDate ?? undefined,
      tags: (linkData.tags as string[]) || [],
      metadata: {
        title: metadata?.title ?? undefined,
        description: metadata?.description ?? undefined,
        image: metadata?.image ?? undefined,
      },
      utmParams:
        (linkData.utmParams as {
          utm_source?: string;
          utm_medium?: string;
          utm_campaign?: string;
          utm_term?: string;
          utm_content?: string;
        }) ?? undefined,
      cloaking: linkData.cloaking ?? false,
      verifiedClicksEnabled: linkData.verifiedClicksEnabled ?? false,
      geoRules:
        geoRules?.map((rule) => ({
          type: rule.type,
          condition: rule.condition,
          values: rule.values as string[],
          action: rule.action,
          destination: rule.destination ?? undefined,
          blockMessage: rule.blockMessage ?? undefined,
        })) ?? [],
    };
  };

  const form = useForm<z.infer<typeof updateLinkSchema>>({
    resolver: zodResolver(updateLinkSchema),
    defaultValues: getFormDefaults(link, existingGeoRules),
  });

  useEffect(() => {
    form.reset(getFormDefaults(link, existingGeoRules));
    setTags((link.tags as string[]) || []);
    setMilestones(
      (existingMilestones ?? []).map((m) => ({
        threshold: m.threshold,
        notifiedAt: m.notifiedAt,
      })),
    );
  }, [link, existingGeoRules, existingMilestones]);

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && tagInput.trim() !== "") {
      e.preventDefault();
      addTag(tagInput.trim());
    } else if (e.key === "ArrowDown" && userTags && userTags.length > 0) {
      setShowTagDropdown(true);
    }
  };

  const addTag = (tagToAdd: string) => {
    if (!tags.includes(tagToAdd)) {
      const newTags = [...tags, tagToAdd];
      setTags(newTags);
      form.setValue("tags", newTags);
      setTagInput("");
    }
    setShowTagDropdown(false);
  };

  const removeTag = (tagToRemove: string) => {
    const newTags = tags.filter((tag) => tag !== tagToRemove);
    setTags(newTags);
    form.setValue("tags", newTags);
  };

  const filteredTags = userTags
    ? userTags
        .filter(
          (tag) =>
            (tagInput === "" || tag.name.toLowerCase().includes(tagInput.toLowerCase())) &&
            !tags.includes(tag.name),
        )
        .map((tag) => tag.name)
    : [];

  async function onSubmit(values: z.infer<typeof updateLinkSchema>) {
    values.tags = tags;
    if (
      activeTab === "qr" ||
      Boolean(link.qrCode) ||
      qrState.pixelStyle !== "rounded" ||
      qrState.darkColor !== "#000000"
    ) {
      values.qrCode = {
        enabled: true,
        title: qrCodeTitle || `${values.alias || link.alias} QR`,
        patternStyle: qrState.pixelStyle,
        cornerStyle: qrState.markerShape,
        selectedColor: qrState.darkColor,
        lightColor: qrState.lightColor,
        logoImage: qrState.logoImage,
        effect: qrState.effect,
        marginNoise: qrState.marginNoise,
        markerInnerShape: qrState.markerInnerShape,
      };
    }
    const thresholds = milestones.map((m) => m.threshold);
    const wasEnabled = link.verifiedClicksEnabled ?? false;
    const isEnabled = values.verifiedClicksEnabled ?? false;
    toast.promise(
      Promise.all([
        formUpdateMutation.mutateAsync(values).then(async (updatedLink) => {
          if (updatedLink && updatedLink.qrCode && canvasRef.current) {
            try {
              const uploadCanvas = document.createElement("canvas");
              await generateQRCode(uploadCanvas, {
                ...qrState,
                text: values.url || link.url || `https://${link.domain}/${link.alias}`,
                scale: 20,
                margin: 2,
              });
              const base64Data = uploadCanvas.toDataURL("image/png");
              await qrCodeSaveImageMutation.mutateAsync({
                id: updatedLink.qrCode.id,
                qrCodeBase64: base64Data,
              });
            } catch (e) {
              log.error({ err: e }, "failed to save updated high-res QR image");
              toast.warning("Link updated, but failed to save high-res QR code image.");
            }
          }
          return updatedLink;
        }),
        milestoneUpsertMutation.mutateAsync({
          linkId: link.id,
          thresholds,
        }),
      ]).then(() => {
        if (isEnabled !== wasEnabled) {
          trackEvent(
            isEnabled
              ? POSTHOG_EVENTS.VERIFIED_CLICKS_ENABLED
              : POSTHOG_EVENTS.VERIFIED_CLICKS_DISABLED,
            {
              linkId: link.id,
              plan: userSubscription?.data?.plan ?? "free",
              source: "edit",
            },
          );
        }
        onClose();
      }),
      {
        loading: "Updating link...",
        success: "Link updated successfully",
        error: "Failed to update link",
      },
    );
  }

  const resolvedPlan = userSubscription?.data?.plan ?? "free";
  const isUltraUser = resolvedPlan === "ultra";
  const isProOrUltraUser = resolvedPlan !== "free";

  // Watch the URL field for debouncing
  const watchedUrl = form.watch("url");
  const [debouncedUrl] = useDebounce(watchedUrl, 500);

  // Check iframe compatibility when cloaking is enabled or URL changes
  const cloakingEnabled = form.watch("cloaking");
  useEffect(() => {
    const controller = new AbortController();

    const checkIframeable = async () => {
      if (!cloakingEnabled || !debouncedUrl) {
        setIframeableResult(null);
        return;
      }

      // Validate URL format first
      try {
        new URL(debouncedUrl);
      } catch {
        setIframeableResult(null);
        return;
      }

      setIsCheckingIframeable(true);
      try {
        const response = await fetch(
          `/api/links/iframeable?url=${encodeURIComponent(debouncedUrl)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        setIframeableResult(data.iframeable);

        if (!data.iframeable) {
          toast.error("This website doesn't allow cloaking. Cloaking has been disabled.");
          form.setValue("cloaking", false);
        }
      } catch (error) {
        // Ignore abort errors (component unmounted or new request started)
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        log.error({ err: error, linkId: link.id }, "failed to check iframe compatibility");
        setIframeableResult(false);
        form.setValue("cloaking", false);
        toast.error("Failed to verify if URL can be cloaked. Please try again.");
      } finally {
        if (!controller.signal.aborted) {
          setIsCheckingIframeable(false);
        }
      }
    };

    void checkIframeable();

    return () => {
      controller.abort();
    };
  }, [cloakingEnabled, debouncedUrl, form]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* Drawer Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-neutral-200 dark:border-border bg-white dark:bg-card"
          >
            {/* Header */}
            <div className="border-b border-neutral-200 dark:border-border px-6 py-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-[14px] font-semibold text-neutral-900 dark:text-foreground">
                    Edit Link
                  </h2>
                  <p className="mt-0.5 text-[13px] text-neutral-500 dark:text-neutral-400">
                    {link.domain}/{link.alias}
                  </p>
                  <div className="mt-2 flex items-center gap-3 text-[12px] text-neutral-400">
                    <span className="flex items-center gap-1">
                      <IconClick
                        size={14}
                        stroke={1.5}
                        className="text-blue-600 dark:text-blue-400"
                      />
                      {link.totalClicks} clicks
                    </span>
                    <span>
                      Created{" "}
                      {link.createdAt ? format(new Date(link.createdAt), "MMM d, yyyy") : "Unknown"}
                    </span>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close drawer"
                  className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-50 dark:hover:bg-accent/50 hover:text-neutral-600"
                >
                  <IconX size={18} stroke={1.5} />
                </button>
              </div>
            </div>

            {/* Form Content */}
            <div className="flex-1 overflow-y-auto">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 p-6">
                  {/* Tab selection */}
                  <div className="flex rounded-xl bg-neutral-100 dark:bg-muted p-1 gap-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab("settings")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-medium transition-all",
                        activeTab === "settings"
                          ? "bg-white dark:bg-card text-neutral-900 dark:text-foreground shadow-sm"
                          : "text-neutral-500 hover:text-neutral-900 dark:hover:text-foreground",
                      )}
                    >
                      <IconSettings size={16} stroke={1.5} />
                      Link Settings
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("routing")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-medium transition-all",
                        activeTab === "routing"
                          ? "bg-white dark:bg-card text-neutral-900 dark:text-foreground shadow-sm"
                          : "text-neutral-500 hover:text-neutral-900 dark:hover:text-foreground",
                      )}
                    >
                      <IconRoute size={16} stroke={1.5} />
                      Advanced Routing
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("qr")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-medium transition-all",
                        activeTab === "qr"
                          ? "bg-white dark:bg-card text-neutral-900 dark:text-foreground shadow-sm"
                          : "text-neutral-500 hover:text-neutral-900 dark:hover:text-foreground",
                      )}
                    >
                      <IconQrcode size={16} stroke={1.5} />
                      QR Code Design
                    </button>
                  </div>

                  {activeTab === "settings" && (
                    <div className="space-y-4">
                      {/* Basic Information */}
                      <div className="space-y-4 rounded-lg border border-neutral-200 dark:border-border p-4">
                        <FormField
                          control={form.control}
                          name="url"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                Destination URL
                              </FormLabel>
                              <FormControl>
                                <Input
                                  className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400 focus-visible:ring-neutral-300"
                                  placeholder="https://site.com"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                Link Name
                              </FormLabel>
                              <FormControl>
                                <Input
                                  className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400 focus-visible:ring-neutral-300"
                                  placeholder="My Awesome Link"
                                  {...field}
                                />
                              </FormControl>
                              <FormDescription className="text-[12px] text-neutral-400 dark:text-neutral-500">
                                A friendly name to identify your link (optional)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="alias"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                Link Alias
                              </FormLabel>
                              <FormControl>
                                <div className="flex h-9 w-full items-center overflow-hidden rounded-md border border-neutral-200 dark:border-border bg-white dark:bg-card transition-colors focus-within:ring-2 focus-within:ring-neutral-300">
                                  <Select>
                                    <SelectTrigger className="h-full w-max shrink-0 gap-1 border-0 bg-transparent px-3 text-[13px] font-medium text-neutral-500 shadow-none ring-0 hover:text-neutral-900 focus:ring-0">
                                      <SelectValue
                                        placeholder={link.domain || DEFAULT_PLATFORM_DOMAIN}
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        {PLATFORM_DOMAINS.map((domain) => (
                                          <SelectItem key={domain} value={domain}>
                                            {domain}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                  <div className="h-4 w-px bg-neutral-200 dark:bg-border" />
                                  <input
                                    placeholder="short-link"
                                    className="h-full flex-1 border-0 bg-transparent px-3 text-[13px] font-medium text-neutral-900 dark:text-foreground placeholder:text-neutral-400 focus:outline-none"
                                    {...field}
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="note"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                Note
                              </FormLabel>
                              <FormControl>
                                <Input
                                  className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400 focus-visible:ring-neutral-300"
                                  placeholder="Add a note to your link"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Tags */}
                        <FormField
                          control={form.control}
                          name="tags"
                          render={() => (
                            <FormItem>
                              <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                Tags
                              </FormLabel>
                              <FormControl>
                                <div className="relative">
                                  {tags.length > 0 && (
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                      {tags.map((tag) => (
                                        <div
                                          key={tag}
                                          className="inline-flex items-center gap-1 rounded-md bg-neutral-100 dark:bg-muted px-2 py-0.5 text-[12px] font-medium text-neutral-600 dark:text-neutral-400"
                                        >
                                          <span>{tag}</span>
                                          <button
                                            type="button"
                                            onClick={() => removeTag(tag)}
                                            aria-label={`Remove tag ${tag}`}
                                            className="text-neutral-400 transition-colors hover:text-neutral-600"
                                          >
                                            <IconX size={12} stroke={1.5} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="relative">
                                    <Input
                                      className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400 focus-visible:ring-neutral-300"
                                      placeholder="Add tags (press Enter)"
                                      value={tagInput}
                                      onChange={(e) => {
                                        setTagInput(e.target.value);
                                        setShowTagDropdown(true);
                                      }}
                                      onKeyDown={handleTagKeyDown}
                                      onBlur={() => {
                                        setTimeout(() => setShowTagDropdown(false), 200);
                                      }}
                                      onFocus={() => setShowTagDropdown(true)}
                                    />

                                    {showTagDropdown && filteredTags.length > 0 && (
                                      <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-neutral-200 dark:border-border bg-white dark:bg-card shadow-md">
                                        {filteredTags.map((tag) => (
                                          <div
                                            key={tag}
                                            className="cursor-pointer px-3 py-2 text-[13px] text-neutral-600 dark:text-neutral-400 transition-colors hover:bg-neutral-50 dark:hover:bg-accent/50 hover:text-neutral-900 dark:hover:text-foreground"
                                            onMouseDown={(e) => {
                                              e.preventDefault();
                                              addTag(tag);
                                            }}
                                          >
                                            {tag}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </FormControl>
                              <FormDescription className="text-[12px] text-neutral-400 dark:text-neutral-500">
                                Press Enter to add a tag, or select from existing tags.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      {/* Custom Social Media Previews */}
                      <SectionToggle
                        title="Custom Social Media Previews"
                        description="Personalize your link previews with custom metadata"
                        isOpen={isCustomMetadataOpen}
                        onToggle={() => setIsCustomMetadataOpen(!isCustomMetadataOpen)}
                        badge={!isProOrUltraUser ? <PlanBadge plan="Pro" /> : undefined}
                      >
                        <FormField
                          control={form.control}
                          name="metadata.title"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                Custom Title
                              </FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400 focus-visible:ring-neutral-300"
                                  placeholder="Custom title for your link"
                                  disabled={!isProOrUltraUser}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="metadata.description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                Custom Description
                              </FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400 focus-visible:ring-neutral-300"
                                  placeholder="Custom description for your link"
                                  disabled={!isProOrUltraUser}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="metadata.image"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                Custom Image
                              </FormLabel>
                              <FormControl>
                                {isProOrUltraUser ? (
                                  <OgImageUploader value={field.value} onChange={field.onChange} />
                                ) : (
                                  <Input
                                    className="h-9 border-neutral-200 bg-white text-[13px] placeholder:text-neutral-400"
                                    placeholder="Upgrade to Pro to add custom images"
                                    disabled
                                  />
                                )}
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </SectionToggle>
                    </div>
                  )}

                  {activeTab === "routing" && (
                    <div className="space-y-4">
                      {/* UTM Parameters */}
                      <SectionToggle
                        title="UTM Parameters"
                        description="Add UTM parameters for campaign tracking"
                        isOpen={isUtmParamsOpen}
                        onToggle={() => setIsUtmParamsOpen(!isUtmParamsOpen)}
                        badge={!isUltraUser ? <PlanBadge plan="Ultra" /> : undefined}
                      >
                        {isUltraUser && (
                          <div className="flex justify-end">
                            <UtmTemplateSelector
                              onSelect={(params) => {
                                form.setValue(
                                  "utmParams.utm_source",
                                  params.utm_source ?? undefined,
                                );
                                form.setValue(
                                  "utmParams.utm_medium",
                                  params.utm_medium ?? undefined,
                                );
                                form.setValue(
                                  "utmParams.utm_campaign",
                                  params.utm_campaign ?? undefined,
                                );
                                form.setValue("utmParams.utm_term", params.utm_term ?? undefined);
                                form.setValue(
                                  "utmParams.utm_content",
                                  params.utm_content ?? undefined,
                                );
                              }}
                            />
                          </div>
                        )}
                        <UtmParamsForm form={form} disabled={!isUltraUser} />
                      </SectionToggle>

                      {/* Link Cloaking */}
                      <SectionToggle
                        title="Link Cloaking"
                        description="Keep your short URL visible while showing destination content"
                        isOpen={isLinkCloakingOpen}
                        onToggle={() => setIsLinkCloakingOpen(!isLinkCloakingOpen)}
                        badge={!isUltraUser ? <PlanBadge plan="Ultra" /> : undefined}
                        highlighted={!!form.watch("cloaking")}
                      >
                        <FormField
                          control={form.control}
                          name="cloaking"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border border-neutral-200 dark:border-border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                  Enable Link Cloaking
                                </FormLabel>
                                <FormDescription className="text-[12px] text-neutral-400 dark:text-neutral-500">
                                  Visitors see your short URL while viewing the destination page.
                                </FormDescription>
                              </div>
                              <FormControl>
                                <div className="flex items-center gap-2">
                                  {isCheckingIframeable && (
                                    <IconLoader2
                                      size={14}
                                      stroke={1.5}
                                      className="animate-spin text-neutral-400"
                                    />
                                  )}
                                  <Switch
                                    checked={field.value ?? false}
                                    onCheckedChange={field.onChange}
                                    disabled={!isUltraUser || !watchedUrl || isCheckingIframeable}
                                  />
                                </div>
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        {!isUltraUser && (
                          <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
                            Link cloaking is an Ultra plan feature.
                          </p>
                        )}

                        {!watchedUrl && isUltraUser && (
                          <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
                            Enter a destination URL above to enable link cloaking.
                          </p>
                        )}

                        {iframeableResult === true && cloakingEnabled && (
                          <p className="text-[12px] text-green-600 dark:text-emerald-400">
                            This URL can be cloaked successfully.
                          </p>
                        )}

                        {iframeableResult === false && (
                          <p className="text-[12px] text-amber-600 dark:text-amber-400">
                            This website doesn&apos;t allow cloaking. Try a different URL.
                          </p>
                        )}
                      </SectionToggle>

                      {/* Verified Clicks */}
                      <SectionToggle
                        title="Verified Clicks"
                        description="Tell real visitors apart from automated traffic"
                        isOpen={isVerifiedClicksOpen}
                        onToggle={() => setIsVerifiedClicksOpen(!isVerifiedClicksOpen)}
                        badge={!isProOrUltraUser ? <PlanBadge plan="Pro" /> : undefined}
                        highlighted={!!form.watch("verifiedClicksEnabled")}
                      >
                        <FormField
                          control={form.control}
                          name="verifiedClicksEnabled"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border border-neutral-200 dark:border-border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                  Enable Verified Clicks
                                </FormLabel>
                                <FormDescription className="text-[12px] text-neutral-400 dark:text-neutral-500">
                                  With this on, your analytics shows which clicks came from real
                                  visitors, not automated traffic — so you can tell real engagement
                                  apart from noise.
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value ?? false}
                                  onCheckedChange={field.onChange}
                                  disabled={!isProOrUltraUser}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        {!isProOrUltraUser && (
                          <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
                            Verified clicks are available on Pro and Ultra plans.
                          </p>
                        )}
                      </SectionToggle>

                      {/* Geotargeting Rules */}
                      <GeoRulesForm
                        form={form}
                        disabled={!isProOrUltraUser}
                        maxRules={isUltraUser ? undefined : 3}
                        isUnlimited={isUltraUser}
                      />

                      {/* Click Milestone Notifications */}
                      <SectionToggle
                        title="Click Milestones"
                        description="Get notified when your link hits click thresholds"
                        isOpen={isMilestonesOpen}
                        onToggle={() => setIsMilestonesOpen(!isMilestonesOpen)}
                        badge={!isProOrUltraUser ? <PlanBadge plan="Pro" /> : undefined}
                      >
                        <MilestoneEditor
                          milestones={milestones}
                          onChange={setMilestones}
                          disabled={!isProOrUltraUser}
                        />
                        {!isProOrUltraUser && (
                          <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
                            Click milestones are available on Pro and Ultra plans.
                          </p>
                        )}
                      </SectionToggle>

                      {/* Optional Settings */}
                      <SectionToggle
                        title="Optional Settings"
                        description="Configure additional options for your link"
                        isOpen={isOptionalSettingsOpen}
                        onToggle={() => setIsOptionalSettingsOpen(!isOptionalSettingsOpen)}
                      >
                        <FormField
                          control={form.control}
                          name="disableLinkAfterClicks"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                Disable after clicks
                              </FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type="number"
                                  className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400 focus-visible:ring-neutral-300"
                                />
                              </FormControl>
                              <FormDescription className="text-[12px] text-neutral-400 dark:text-neutral-500">
                                Deactivate after a certain number of clicks. Leave empty to never
                                disable.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="disableLinkAfterDate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                Disable after date
                              </FormLabel>
                              <FormControl>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      className={cn(
                                        "h-9 w-full justify-start border-neutral-200 dark:border-border text-left text-[13px] font-normal hover:bg-neutral-50 dark:hover:bg-accent/50",
                                        !field.value && "text-neutral-400",
                                      )}
                                    >
                                      <IconCalendar
                                        size={14}
                                        stroke={1.5}
                                        className="mr-2 text-neutral-400"
                                      />
                                      {field.value ? (
                                        format(new Date(field.value), "PPP")
                                      ) : (
                                        <span>Pick a date</span>
                                      )}
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0">
                                    <Calendar
                                      mode="single"
                                      selected={field.value ? new Date(field.value) : undefined}
                                      onSelect={(date) => field.onChange(date)}
                                      initialFocus
                                      disabled={(date) => date < new Date()}
                                    />
                                  </PopoverContent>
                                </Popover>
                              </FormControl>
                              <FormDescription className="text-[12px] text-neutral-400 dark:text-neutral-500">
                                Deactivate the link after a certain date.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </SectionToggle>
                    </div>
                  )}

                  {activeTab === "qr" && (
                    <div className="space-y-6 rounded-lg border border-neutral-200 dark:border-border p-4">
                      <div className="flex flex-col items-center justify-center rounded-xl bg-neutral-50 dark:bg-muted/50 p-6">
                        <div className="rounded-2xl border border-neutral-200/60 bg-white p-4 shadow-sm">
                          <canvas
                            ref={canvasRef}
                            className="max-w-[200px] max-h-[200px] w-full h-full block"
                          />
                        </div>
                      </div>

                      <div>
                        <FormLabel className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                          QR Code Title
                        </FormLabel>
                        <Input
                          placeholder="E.g. Summer Promo Flyer QR"
                          value={qrCodeTitle}
                          onChange={(e) => setQrCodeTitle(e.target.value)}
                          className="mt-1.5 h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400"
                        />
                      </div>

                      <QRAdvancedCustomization
                        pixelStyle={qrState.pixelStyle}
                        setPixelStyle={(style) => updateQrState({ pixelStyle: style })}
                        markerShape={qrState.markerShape}
                        setMarkerShape={(shape) => updateQrState({ markerShape: shape })}
                        markerInnerShape={qrState.markerInnerShape}
                        setMarkerInnerShape={(shape) => updateQrState({ markerInnerShape: shape })}
                        darkColor={qrState.darkColor}
                        setDarkColor={(color) => updateQrState({ darkColor: color })}
                        lightColor={qrState.lightColor}
                        setLightColor={(color) => updateQrState({ lightColor: color })}
                        effect={qrState.effect}
                        setEffect={(effect) => updateQrState({ effect })}
                        effectRadius={qrState.effectCrystalizeRadius}
                        setEffectRadius={(radius) =>
                          updateQrState({
                            effectCrystalizeRadius: radius,
                            effectLiquidifyRadius: radius,
                          })
                        }
                        marginNoise={qrState.marginNoise}
                        setMarginNoise={(marginNoise) => updateQrState({ marginNoise })}
                        marginNoiseRate={qrState.marginNoiseRate}
                        setMarginNoiseRate={(marginNoiseRate) => updateQrState({ marginNoiseRate })}
                        logoImage={qrState.logoImage}
                        setLogoImage={(logoImage) => updateQrState({ logoImage })}
                        logoSize={qrState.logoSize}
                        setLogoSize={(logoSize) => updateQrState({ logoSize })}
                        logoMargin={qrState.logoMargin}
                        setLogoMargin={(logoMargin) => updateQrState({ logoMargin })}
                        logoBorderRadius={qrState.logoBorderRadius}
                        setLogoBorderRadius={(logoBorderRadius) =>
                          updateQrState({ logoBorderRadius })
                        }
                      />
                    </div>
                  )}
                </form>
              </Form>
            </div>

            {/* Footer */}
            <div className="border-t border-neutral-200 dark:border-border bg-neutral-50 dark:bg-accent/50 px-6 py-4">
              <div className="flex items-center justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="h-9 border-neutral-200 dark:border-border text-[13px] hover:bg-neutral-50 dark:hover:bg-accent/50"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={formUpdateMutation.isLoading || qrCodeSaveImageMutation.isLoading}
                  className="h-9 bg-blue-600 text-[13px] text-white hover:bg-blue-700"
                >
                  {formUpdateMutation.isLoading ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
