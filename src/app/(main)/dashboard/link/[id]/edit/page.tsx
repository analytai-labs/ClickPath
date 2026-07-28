"use client";

import { POSTHOG_EVENTS, trackEvent } from "@/lib/analytics/events";
import { notifyPlanLimit } from "@/lib/analytics/upgrade-prompt";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  IconLoader2,
  IconX,
  IconQrcode,
  IconSettings,
  IconRoute,
} from "@tabler/icons-react";
import { useTransitionRouter } from "next-view-transitions";
import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { defaultGeneratorState, generateQRCode } from "@/lib/qr-generator";
import type { QRCodeGeneratorState } from "@/lib/qr-generator";
import { QRAdvancedCustomization } from "../../../qrcodes/create/_components/qr-advanced-customization";
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
import { Switch } from "@/components/ui/switch";
import { DEFAULT_PLATFORM_DOMAIN } from "@/lib/constants/domains";
import { clientLogger } from "@/lib/logger/client";
import { fetchMetadataInfo } from "@/lib/utils/fetch-link-metadata";
import { updateLinkSchema } from "@/server/api/routers/link/link.input";
import { api } from "@/trpc/react";

import { LinkExpirationDatePicker } from "../../../_components/links/link-card/update-modal";
import { PlanBadge, SectionToggle } from "../../../_components/section-toggle";
import { UtmParamsForm } from "../../../_components/utm-params-form";
import { UtmTemplateSelector } from "../../../_components/utm-template-selector";
import { revalidateHomepage } from "../../../revalidate-homepage";

import { LinkPreviewComponent } from "../../new/_components/link-preview";
import { OgImageUploader } from "../../new/_components/og-image-uploader";

import type { CustomDomain } from "@prisma/client";
import type { z } from "zod";

const log = clientLogger.child({ component: "edit-link-page" });

// Lazy load GeoRulesForm to reduce initial bundle size (includes framer-motion)
const GeoRulesForm = dynamic(
  () => import("../../../_components/geo-rules-form").then((mod) => mod.GeoRulesForm),
  { ssr: false },
);

type LinkMetadata = {
  title?: string;
  description?: string;
  image?: string;
};

export default function EditLinkPage() {
  const router = useTransitionRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const activeTabParam = searchParams.get("tab") as "settings" | "routing" | "qr" | null;

  const linkId = Number(params?.id);

  const { data: link, isLoading: isLinkLoading } = api.link.get.useQuery(
    { id: linkId },
    { enabled: !isNaN(linkId) },
  );

  const [destinationURL, setDestinationURL] = useState<string | undefined>();
  const [userDomains, setUserDomains] = useState<CustomDomain[]>([]);
  const [isCustomMetadataOpen, setIsCustomMetadataOpen] = useState(false);
  const [isUtmParamsOpen, setIsUtmParamsOpen] = useState(false);
  const [isOptionalSettingsOpen, setIsOptionalSettingsOpen] = useState(false);
  const [metaData, setMetaData] = useState({
    title: "",
    description: "",
    image: "",
    favicon: "",
  });
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [isLinkCloakingOpen, setIsLinkCloakingOpen] = useState(false);
  const [isCheckingIframeable, setIsCheckingIframeable] = useState(false);
  const [iframeableResult, setIframeableResult] = useState<boolean | null>(null);
  const [isVerifiedClicksOpen, setIsVerifiedClicksOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<"settings" | "routing" | "qr">(
    activeTabParam === "qr" || activeTabParam === "routing" ? activeTabParam : "settings",
  );
  
  const [qrState, setQrState] = useState<QRCodeGeneratorState>(defaultGeneratorState);
  const [qrCodeTitle, setQrCodeTitle] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const { data: existingGeoRules } = api.geoRules.getByLinkId.useQuery(
    { linkId: linkId },
    { enabled: !isNaN(linkId) },
  );
  
  const qrCodeSaveImageMutation = api.qrCode.saveImage.useMutation();

  const userSubscription = api.subscriptions.get.useQuery();
  const customDomainsQuery = api.customDomain.list.useQuery();
  const { data: userTags } = api.tag.list.useQuery();
  
  const formUpdateMutation = api.link.update.useMutation({
    onSuccess: async () => {
      await revalidateHomepage();
    },
    onError: (error) => {
      if (error.data?.code === "FORBIDDEN" || /upgrade/i.test(error.message)) {
        notifyPlanLimit(error.message, "link_update");
      } else {
        toast.error(error.message);
      }
    },
  });

  const getFormDefaults = useCallback((linkData: typeof link, geoRules?: typeof existingGeoRules) => {
    if (!linkData) return { id: linkId, url: "", alias: "" };
    
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
  }, [linkId]);

  const form = useForm<z.infer<typeof updateLinkSchema>>({
    resolver: zodResolver(updateLinkSchema),
    defaultValues: getFormDefaults(link, existingGeoRules),
  });

  useEffect(() => {
    if (link) {
      form.reset(getFormDefaults(link, existingGeoRules));
      setDestinationURL(link.url || undefined);
      setTags((link.tags as string[]) || []);
      
      const metadata = link.metadata as LinkMetadata | undefined;
      setMetaData(prev => ({
        ...prev,
        title: metadata?.title ?? "",
        description: metadata?.description ?? "",
        image: metadata?.image ?? "",
      }));
      
      setQrCodeTitle(link.qrCode?.title ?? "");
      const base = defaultGeneratorState();
      if (link.qrCode) {
        if (link.qrCode.patternStyle) base.pixelStyle = link.qrCode.patternStyle as any;
        if (link.qrCode.cornerStyle) base.markerShape = link.qrCode.cornerStyle as any;
        if (link.qrCode.color) base.darkColor = link.qrCode.color;
        if (link.qrCode.lightColor) base.lightColor = link.qrCode.lightColor;
        if (link.qrCode.logoImage) base.logoImage = link.qrCode.logoImage;
        if (link.qrCode.effect) base.effect = link.qrCode.effect as any;
        if (link.qrCode.marginNoise !== undefined && link.qrCode.marginNoise !== null) base.marginNoise = link.qrCode.marginNoise;
        if (link.qrCode.markerInnerShape) base.markerInnerShape = link.qrCode.markerInnerShape as any;
      }
      setQrState(base);
    }
  }, [link, existingGeoRules]);

  const [debouncedUrl] = useDebounce(destinationURL, 500);

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

  const [debouncedQrState] = useDebounce(qrState, 100);
  const regenerateQRCode = useCallback(async () => {
    if (!canvasRef.current) return;
    try {
      const dest = destinationURL || form.getValues("url") || (link ? `https://${link.domain}/${link.alias}` : "https://clickpath.analytai.in");
      await generateQRCode(canvasRef.current, {
        ...qrState,
        text: dest,
      });
    } catch (err) {
      console.error("Failed to generate QR code preview:", err);
    }
  }, [qrState, destinationURL, link]);

  useEffect(() => {
    if (activeTab === "qr") {
      void regenerateQRCode();
    }
  }, [debouncedQrState, destinationURL, activeTab, regenerateQRCode]);

  const updateQrState = useCallback((updates: Partial<QRCodeGeneratorState>) => {
    setQrState((prev) => ({ ...prev, ...updates }));
  }, []);

  async function onSubmit(values: z.infer<typeof updateLinkSchema>) {
    values.tags = tags;
    if (
      activeTab === "qr" ||
      Boolean(link?.qrCode) ||
      qrState.pixelStyle !== "rounded" ||
      qrState.darkColor !== "#000000"
    ) {
      values.qrCode = {
        enabled: true,
        title: qrCodeTitle || `${values.alias || link?.alias} QR`,
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

    const wasEnabled = link?.verifiedClicksEnabled ?? false;
    const isEnabled = values.verifiedClicksEnabled ?? false;
    
    try {
      const updatedLink = await formUpdateMutation.mutateAsync(values);
      if (updatedLink && updatedLink.qrCode && canvasRef.current) {
        try {
          const uploadCanvas = document.createElement("canvas");
          await generateQRCode(uploadCanvas, {
            ...qrState,
            text: values.url || link?.url || `https://${link?.domain}/${link?.alias}`,
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

      if (isEnabled !== wasEnabled) {
        trackEvent(
          isEnabled
            ? POSTHOG_EVENTS.VERIFIED_CLICKS_ENABLED
            : POSTHOG_EVENTS.VERIFIED_CLICKS_DISABLED,
          {
            linkId: link?.id,
            plan: userSubscription?.data?.plan ?? "free",
            source: "edit",
          },
        );
      }
      
      toast.success("Link updated successfully");
      router.push("/dashboard");
    } catch (err) {
      // Error handled by mutation onError
      return;
    }
  }

  useEffect(() => {
    if (customDomainsQuery.data) {
      setUserDomains(customDomainsQuery.data);
    }
  }, [customDomainsQuery.data]);

  useEffect(() => {
    const fetchMetadata = async () => {
      if (!debouncedUrl || form.formState.errors.url || !form.getValues("url")) {
        return;
      }

      const customTitle = form.getValues("metadata.title");
      const customDescription = form.getValues("metadata.description");
      const customImage = form.getValues("metadata.image");

      try {
        const fetchedMetadata = await fetchMetadataInfo(debouncedUrl);

        setMetaData((prev) => ({
          title: customTitle || fetchedMetadata.title,
          description: customDescription || fetchedMetadata.description,
          image: customImage || fetchedMetadata.image,
          favicon: fetchedMetadata.favicon,
        }));
      } catch (error) {
        log.warn({ err: error, action: "fetch-metadata" }, "failed to fetch metadata");
      }
    };

    void fetchMetadata();
  }, [debouncedUrl]);

  const cloakingEnabled = form.watch("cloaking");
  useEffect(() => {
    const controller = new AbortController();

    const checkIframeable = async () => {
      if (!cloakingEnabled || !debouncedUrl) {
        setIframeableResult(null);
        return;
      }

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
          toast.error("This website doesn't allow cloaking.");
          form.setValue("cloaking", false);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        log.error(
          { err: error, action: "check-cloaking" },
          "failed to check cloaking compatibility",
        );
        setIframeableResult(false);
        form.setValue("cloaking", false);
        toast.error("Failed to check if URL can be cloaked. Please try again.");
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

  const isProUser = (userSubscription?.data?.plan ?? "free") !== "free";
  const isUltraUser = userSubscription?.data?.plan === "ultra";

  if (isLinkLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <IconLoader2 className="h-8 w-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!link) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Link not found</h2>
        <p className="text-sm text-neutral-500">The link you are trying to edit does not exist or you do not have permission to view it.</p>
        <Button onClick={() => router.push("/dashboard")}>Back to Dashboard</Button>
      </div>
    );
  }

  return (
    <section className="grid grid-cols-1 gap-5 md:grid-cols-11 pb-24">
      <div className="md:col-span-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-foreground">
              Edit link
            </h2>
            <p className="mt-1 text-[13px] text-neutral-400">
              {link.domain}/{link.alias}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard")}>
            <IconX size={16} className="mr-1" /> Cancel
          </Button>
        </div>
        <Form {...form}>
          <form 
            onSubmit={form.handleSubmit(onSubmit, (errors) => {
              toast.error("Please check the form for errors before saving.");
              log.error({ errors }, "Form validation failed in EditLinkPage");
            })} 
            className="mt-5 space-y-5"
          >
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
                        placeholder="https://site.com"
                        className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400"
                        {...field}
                        onChange={(e) => {
                          setDestinationURL(e.target.value);
                          field.onChange(e);
                        }}
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
                        placeholder="My Awesome Link"
                        className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400"
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
                      <div className="flex h-9 w-full items-center overflow-hidden rounded-lg border border-neutral-200 dark:border-border bg-white dark:bg-card transition-colors hover:border-neutral-300 dark:hover:border-border focus-within:border-neutral-300 focus-within:ring-1 focus-within:ring-neutral-300">
                        <div className="flex h-full w-max shrink-0 items-center gap-1 border-0 bg-transparent px-3 text-[13px] font-medium text-neutral-500">
                          {link.domain || DEFAULT_PLATFORM_DOMAIN}
                        </div>
                        <div className="h-4 w-px bg-neutral-200 dark:bg-border" />
                        <input
                          placeholder="short-link"
                          className="h-full flex-1 border-0 bg-transparent px-3 text-[13px] font-medium text-neutral-900 dark:text-foreground placeholder:text-neutral-400 focus:outline-none"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormDescription className="text-[12px] text-neutral-400 dark:text-neutral-500">
                      Note: You cannot change the domain for an existing link, only the alias.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                <div className="space-y-4 rounded-lg border border-neutral-200 dark:border-border p-4">
                  {/* Note */}
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
                            className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription className="text-[12px] text-neutral-400 dark:text-neutral-500">
                          Add a note to your link
                        </FormDescription>
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
                            <div className="mb-2 flex flex-wrap gap-2">
                              {tags.map((tag) => (
                                <div
                                  key={tag}
                                  className="flex items-center gap-1 rounded-md bg-neutral-100 dark:bg-muted px-2 py-1 text-[12px] text-neutral-600 dark:text-neutral-400"
                                >
                                  <span>{tag}</span>
                                  <button
                                    type="button"
                                    onClick={() => removeTag(tag)}
                                    aria-label={`Remove tag ${tag}`}
                                    className="text-neutral-400 hover:text-neutral-600"
                                  >
                                    <IconX size={12} stroke={1.5} />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <div className="relative">
                              <Input
                                placeholder="Add tags (press Enter to add)"
                                className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400"
                                value={tagInput}
                                onChange={(e) => {
                                  setTagInput(e.target.value);
                                  setShowTagDropdown(true);
                                }}
                                onKeyDown={handleTagKeyDown}
                                onBlur={() => {
                                  setTimeout(() => setShowTagDropdown(false), 200);
                                }}
                                onFocus={() => {
                                  setShowTagDropdown(true);
                                }}
                              />

                              {/* Tag dropdown */}
                              {showTagDropdown && filteredTags.length > 0 && (
                                <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-neutral-200 dark:border-border bg-white dark:bg-card shadow-md">
                                  {filteredTags.map((tag) => (
                                    <div
                                      key={tag}
                                      className="cursor-pointer px-4 py-2 text-[13px] hover:bg-neutral-50 dark:hover:bg-accent/50"
                                      onMouseDown={(e) => {
                                        e.preventDefault(); // Prevent input blur
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
                          Add tags to categorize your links. Press Enter to add a tag or select from
                          existing tags.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Custom Metadata Section */}
                <SectionToggle
                  title="Custom Social Media Previews"
                  description="Personalize your link previews with custom metadata settings"
                  isOpen={isCustomMetadataOpen}
                  onToggle={() => setIsCustomMetadataOpen(!isCustomMetadataOpen)}
                  badge={!isProUser ? <PlanBadge plan="Pro" /> : undefined}
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
                            placeholder="Custom title for your link"
                            className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400"
                            onChange={(e) => {
                              field.onChange(e);
                              setMetaData((prev) => ({
                                ...prev,
                                title: e.target.value,
                              }));
                            }}
                          />
                        </FormControl>
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
                            placeholder="Custom description for your link"
                            className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px] placeholder:text-neutral-400"
                            onChange={(e) => {
                              field.onChange(e);
                              setMetaData((prev) => ({
                                ...prev,
                                description: e.target.value,
                              }));
                            }}
                          />
                        </FormControl>
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
                          <OgImageUploader
                            value={field.value}
                            onChange={(image) => {
                              field.onChange(image);
                              setMetaData((prev) => ({
                                ...prev,
                                image: image || "",
                              }));
                            }}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </SectionToggle>
              </div>
            )}

            {activeTab === "routing" && (
              <div className="space-y-4">
                {/* UTM Parameters Section */}
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
                          form.setValue("utmParams.utm_source", params.utm_source ?? "");
                          form.setValue("utmParams.utm_medium", params.utm_medium ?? "");
                          form.setValue("utmParams.utm_campaign", params.utm_campaign ?? "");
                          form.setValue("utmParams.utm_term", params.utm_term ?? "");
                          form.setValue("utmParams.utm_content", params.utm_content ?? "");
                        }}
                      />
                    </div>
                  )}
                  <UtmParamsForm form={form} disabled={!isUltraUser} />
                </SectionToggle>

                {/* Link Cloaking Section */}
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
                              disabled={!isUltraUser || !destinationURL || isCheckingIframeable}
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

                {/* Verified Clicks Section */}
                <SectionToggle
                  title="Verified Clicks"
                  description="Tell real visitors apart from automated traffic"
                  isOpen={isVerifiedClicksOpen}
                  onToggle={() => setIsVerifiedClicksOpen(!isVerifiedClicksOpen)}
                  badge={!isProUser ? <PlanBadge plan="Pro" /> : undefined}
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
                            With this on, your analytics shows which clicks came from real visitors,
                            not automated traffic — so you can tell real engagement apart from
                            noise.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value ?? false}
                            onCheckedChange={field.onChange}
                            disabled={!isProUser}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  {!isProUser && (
                    <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
                      Verified clicks are available on Pro and Ultra plans.
                    </p>
                  )}
                </SectionToggle>

                {/* Geotargeting Rules Section */}
                <GeoRulesForm
                  form={form}
                  disabled={!isProUser}
                  maxRules={isUltraUser ? undefined : 3}
                  isUnlimited={isUltraUser}
                />

                {/* Optional Settings Section */}
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
                            className="h-9 border-neutral-200 dark:border-border bg-white dark:bg-card text-[13px]"
                          />
                        </FormControl>
                        <FormDescription className="text-[12px] text-neutral-400 dark:text-neutral-500">
                          Deactivate the link after a certain number of clicks. Leave empty to never
                          disable
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
                          <LinkExpirationDatePicker setSeletectedDate={field.onChange} />
                        </FormControl>
                        <FormDescription className="text-[12px] text-neutral-400 dark:text-neutral-500">
                          Deactivate the link after a certain date
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </SectionToggle>
              </div>
            )}

            {activeTab === "qr" && (
              <div className="space-y-5 rounded-lg border border-neutral-200 dark:border-border p-4">
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
                  <FormDescription className="mt-1 text-[12px] text-neutral-400 dark:text-neutral-500">
                    Give this QR code a name so you can easily identify it later.
                  </FormDescription>
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
                    updateQrState({ effectCrystalizeRadius: radius, effectLiquidifyRadius: radius })
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
                  setLogoBorderRadius={(logoBorderRadius) => updateQrState({ logoBorderRadius })}
                />
              </div>
            )}

            <Button
              type="submit"
              className="mt-10 w-full bg-blue-600 text-[13px] hover:bg-blue-700"
              disabled={formUpdateMutation.isLoading || qrCodeSaveImageMutation.isLoading}
            >
              {formUpdateMutation.isLoading
                ? "Saving..."
                : "Save Changes"}
            </Button>
          </form>
        </Form>
      </div>
      <div className="hidden items-center justify-center md:flex">
        <div className="h-screen border-r border-neutral-200 dark:border-border" />
      </div>
      <div className="mt-4 flex flex-col gap-4 md:col-span-5 md:mt-0 sticky top-24 self-start">
        {activeTab === "qr" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-foreground">
                QR Code Preview
              </h1>
              <p className="text-[13px] text-neutral-400">
                Live preview of your customized QR code
              </p>
            </div>
            <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 dark:border-border bg-white dark:bg-card p-6 shadow-sm">
              <div className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm">
                <canvas ref={canvasRef} className="max-w-[240px] max-h-[240px] w-full h-full" />
              </div>
              <p className="mt-4 text-center text-xs text-neutral-400">
                Scans to:{" "}
                <span className="font-medium text-neutral-600 dark:text-neutral-300 break-all">
                  {destinationURL || (link ? `https://${link.domain}/${link.alias}` : "https://clickpath.analytai.in")}
                </span>
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-foreground">
                How users see your link
              </h1>
              <p className="text-[13px] text-neutral-400">
                This is how your link will be displayed to users on social platforms
              </p>
            </div>
            <LinkPreviewComponent
              destinationURL={destinationURL || link?.url || undefined}
              metaTitle={metaData.title}
              metaDescription={metaData.description}
              metaImage={metaData.image}
              favicon={metaData.favicon}
            />
          </div>
        )}
      </div>
    </section>
  );
}
