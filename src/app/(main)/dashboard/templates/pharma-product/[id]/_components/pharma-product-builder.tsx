"use client";

import {
  IconArrowLeft,
  IconDeviceTablet,
  IconExternalLink,
  IconSettings,
  IconTrendingUp,
} from "@tabler/icons-react";
import { Link } from "next-view-transitions";
import { useState } from "react";
import { toast } from "sonner";

import { PharmaProductRenderer } from "@/components/templates/pharma-product/pharma-product-renderer";
import { AnalyticsPanel } from "@/app/(main)/dashboard/bio-pages/[id]/_components/analytics-panel";
import {
  PHARMA_PRESET_LABELS,
  PHARMA_PRESET_OPTIONS,
} from "@/components/templates/pharma-product/pharma-product-theme";
import {
  EMPTY_PHARMA_PRODUCT_DATA,
  type PharmaProductData,
} from "@/components/templates/types";
import { ImageUploadTile } from "@/components/ui/image-upload-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Plan } from "@/lib/billing/plans";
import { api } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/shared";

type PharmaPageData = RouterOutputs["templatePage"]["get"];

type Props = {
  pageId: number;
  initialData: PharmaPageData;
  plan: Plan;
};

function getPharmaData(page: PharmaPageData): PharmaProductData {
  const raw = page.templateData as Partial<PharmaProductData> | null;
  if (!raw) return EMPTY_PHARMA_PRODUCT_DATA;
  return {
    productName: raw.productName ?? "",
    composition: raw.composition ?? "",
    productOverview: raw.productOverview ?? "",
    marketed: raw.marketed ?? { name: "", address: "" },
    manufactured: raw.manufactured ?? { name: "", address: "" },
    productImages: raw.productImages ?? [],
    documents: raw.documents ?? [],
    contact: raw.contact ?? { name: "", whatsapp: "", email: "" },
  };
}

export function PharmaProductBuilder({ pageId, initialData, plan }: Props) {
  const [data, setData] = useState<PharmaProductData>(getPharmaData(initialData));
  const [themePreset, setThemePreset] = useState<string>(
    (initialData.theme as { preset?: string } | null)?.preset ?? "clean",
  );
  const [isPublished, setIsPublished] = useState(initialData.isPublished ?? false);
  const [isDirty, setIsDirty] = useState(false);

  const utils = api.useUtils();

  const saveProduct = api.templatePage.updatePharmaProduct.useMutation({
    onSuccess: () => {
      toast.success("Saved!");
      setIsDirty(false);
      void utils.templatePage.get.invalidate({ id: pageId });
    },
    onError: (e) => toast.error(e.message),
  });

  const togglePublished = api.templatePage.togglePublished.useMutation({
    onSuccess: (res) => {
      setIsPublished(res.isPublished);
      toast.success(res.isPublished ? "Page is live." : "Page set to draft.");
    },
    onError: (e) => toast.error(e.message),
  });

  function updateField<K extends keyof PharmaProductData>(
    key: K,
    value: PharmaProductData[K],
  ) {
    setData((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }

  function handleSave() {
    saveProduct.mutate({
      id: pageId,
      data,
      theme: { preset: themePreset },
    });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-border dark:bg-card">
        <Link
          href="/dashboard/templates"
          className="flex items-center gap-1.5 text-[13px] text-neutral-500 hover:text-neutral-900 dark:hover:text-foreground"
        >
          <IconArrowLeft size={14} stroke={2} />
          Templates
        </Link>
        <span className="text-neutral-300 dark:text-border">/</span>
        <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-foreground">
          {initialData.title || initialData.slug}
        </span>
        <Badge variant="outline" className="ml-0.5 text-[10px]">
          Pharma Product
        </Badge>
        {isPublished ? (
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Live</Badge>
        ) : (
          <Badge variant="secondary">Draft</Badge>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isPublished && (
            <a
              href={`/p/${initialData.slug}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-muted"
            >
              <IconExternalLink size={14} />
              View live
            </a>
          )}
          <div className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5 dark:border-border">
            <Switch
              id="pharma-published"
              checked={isPublished}
              onCheckedChange={(checked) =>
                togglePublished.mutate({ id: pageId, isPublished: checked })
              }
              disabled={togglePublished.isLoading}
            />
            <label
              htmlFor="pharma-published"
              className="cursor-pointer select-none text-[12px] text-neutral-600 dark:text-neutral-400"
            >
              {isPublished ? "Published" : "Draft"}
            </label>
          </div>
          <Button
            onClick={handleSave}
            disabled={!isDirty || saveProduct.isLoading}
            className="h-8 px-3 text-[13px]"
          >
            {saveProduct.isLoading ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Main body */}
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        {/* Editor — takes the remaining width; the preview is a fixed right rail */}
        <div className="min-w-0 flex-1">
          <Tabs defaultValue="content">
            <TabsList>
              <TabsTrigger value="content" className="gap-1.5">
                <IconDeviceTablet size={16} /> Content
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-1.5">
                <IconSettings size={16} /> Settings
              </TabsTrigger>
              <TabsTrigger value="analytics" className="gap-1.5">
                <IconTrendingUp size={16} /> Analytics
              </TabsTrigger>
            </TabsList>

            <TabsContent 
              value="content" 
              className="mt-4 max-w-2xl space-y-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both motion-safe:duration-300"
            >
              <FieldSection title="Product Info">
                <Field label="Product Name">
                  <input
                    className="input-base"
                    value={data.productName}
                    onChange={(e) => updateField("productName", e.target.value)}
                    placeholder="e.g. Amoxicillin 500mg Capsules"
                  />
                </Field>
                <Field label="Composition">
                  <textarea
                    className="input-base resize-none"
                    rows={2}
                    value={data.composition}
                    onChange={(e) => updateField("composition", e.target.value)}
                    placeholder="e.g. Each capsule contains Amoxicillin 500mg"
                  />
                </Field>
                <Field label="Product Overview">
                  <textarea
                    className="input-base resize-none"
                    rows={4}
                    value={data.productOverview}
                    onChange={(e) => updateField("productOverview", e.target.value)}
                    placeholder="Describe the product, indications, usage..."
                  />
                </Field>
              </FieldSection>

              <FieldSection title="Marketed By">
                <Field label="Company Name">
                  <input
                    className="input-base"
                    value={data.marketed.name}
                    onChange={(e) =>
                      updateField("marketed", { ...data.marketed, name: e.target.value })
                    }
                    placeholder="e.g. Acme Pharma Ltd."
                  />
                </Field>
                <Field label="Address">
                  <textarea
                    className="input-base resize-none"
                    rows={2}
                    value={data.marketed.address}
                    onChange={(e) =>
                      updateField("marketed", { ...data.marketed, address: e.target.value })
                    }
                    placeholder="City, State, Country"
                  />
                </Field>
              </FieldSection>

              <FieldSection title="Manufactured By">
                <Field label="Company Name">
                  <input
                    className="input-base"
                    value={data.manufactured.name}
                    onChange={(e) =>
                      updateField("manufactured", { ...data.manufactured, name: e.target.value })
                    }
                    placeholder="e.g. WHO-GMP Pharma Labs"
                  />
                </Field>
                <Field label="Address">
                  <textarea
                    className="input-base resize-none"
                    rows={2}
                    value={data.manufactured.address}
                    onChange={(e) =>
                      updateField("manufactured", {
                        ...data.manufactured,
                        address: e.target.value,
                      })
                    }
                    placeholder="Manufacturing plant address"
                  />
                </Field>
              </FieldSection>

              <FieldSection title="Contact">
                <Field label="Contact Person">
                  <input
                    className="input-base"
                    value={data.contact.name}
                    onChange={(e) =>
                      updateField("contact", { ...data.contact, name: e.target.value })
                    }
                    placeholder="Sales / MR Name"
                  />
                </Field>
                <Field label="WhatsApp Number">
                  <input
                    className="input-base"
                    type="tel"
                    value={data.contact.whatsapp}
                    onChange={(e) =>
                      updateField("contact", { ...data.contact, whatsapp: e.target.value })
                    }
                    placeholder="+91 98765 43210"
                  />
                </Field>
                <Field label="Email">
                  <input
                    className="input-base"
                    type="email"
                    value={data.contact.email}
                    onChange={(e) =>
                      updateField("contact", { ...data.contact, email: e.target.value })
                    }
                    placeholder="sales@company.com"
                  />
                </Field>
              </FieldSection>

              <FieldSection title="Product Images">
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Upload product packshots (PNG, JPEG, WebP — max 2 MB each, up to 10).
                </p>
                {/* 3-column tile grid */}
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: Math.min(10, data.productImages.length + 1) }).map(
                    (_, i) => (
                      <ImageUploadTile
                        key={i}
                        value={data.productImages[i] ?? null}
                        onChange={(val) => {
                          const next = [...data.productImages];
                          if (val === null) {
                            next.splice(i, 1);
                          } else {
                            next[i] = val;
                          }
                          updateField("productImages", next.filter(Boolean));
                        }}
                        label={i === 0 ? "Front view" : i === 1 ? "Back view" : "Add image"}
                        ariaLabel={`Product image ${i + 1}`}
                      />
                    ),
                  )}
                </div>
              </FieldSection>

              <FieldSection title="Documents / Literature">
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Visual aids and product literature — upload an image and add a label for each.
                </p>
                <div className="space-y-3">
                  {data.documents.map((doc, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-neutral-200 p-3 dark:border-border"
                    >
                      <div className="flex gap-3">
                        {/* Image tile */}
                        <ImageUploadTile
                          value={doc.imageUrl || null}
                          onChange={(val) => {
                            const next = [...data.documents];
                            next[i] = { ...doc, imageUrl: val ?? "" };
                            updateField("documents", next);
                          }}
                          label="Upload"
                          ariaLabel={`Document image ${i + 1}`}
                          className="w-20 shrink-0"
                        />
                        {/* Label + actions */}
                        <div className="flex flex-1 flex-col justify-between gap-1.5">
                          <input
                            className="input-base text-[12px]"
                            value={doc.name}
                            onChange={(e) => {
                              const next = [...data.documents];
                              next[i] = { ...doc, name: e.target.value };
                              updateField("documents", next);
                            }}
                            placeholder="Label (e.g. Visual Aid, PI Sheet)"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateField(
                                "documents",
                                data.documents.filter((_, di) => di !== i),
                              )
                            }
                            className="self-start text-[11px] text-red-500 hover:text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {data.documents.length < 20 && (
                    <button
                      type="button"
                      onClick={() =>
                        updateField("documents", [
                          ...data.documents,
                          { imageUrl: "", name: "" },
                        ])
                      }
                      className="w-full rounded-xl border-2 border-dashed border-neutral-200 py-3 text-[12px] text-neutral-500 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-border"
                    >
                      + Add document
                    </button>
                  )}
                </div>
              </FieldSection>
            </TabsContent>

            <TabsContent value="settings" className="p-4 space-y-5">
              <FieldSection title="Theme">
                <div className="grid grid-cols-2 gap-2">
                  {PHARMA_PRESET_OPTIONS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => {
                        setThemePreset(preset);
                        setIsDirty(true);
                      }}
                      className={`rounded-xl border px-3 py-2 text-[12px] font-medium transition-colors ${
                        themePreset === preset
                          ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-300"
                          : "border-neutral-200 text-neutral-600 hover:border-neutral-300 dark:border-border dark:text-neutral-400"
                      }`}
                    >
                      {PHARMA_PRESET_LABELS[preset]}
                    </button>
                  ))}
                </div>
              </FieldSection>

              <FieldSection title="Page handle">
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                  URL: <code className="font-mono">/p/{initialData.slug}</code>
                </p>
                <p className="text-[11px] text-neutral-400">
                  To change the slug, use the settings in the main Templates list.
                </p>
              </FieldSection>
            </TabsContent>

            <TabsContent 
              value="analytics" 
              className="mt-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both motion-safe:duration-300"
            >
              <AnalyticsPanel pageId={pageId} plan={plan} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Live preview — fixed right rail, aligned under the header actions */}
        <div className="hidden shrink-0 lg:sticky lg:top-6 lg:block lg:w-[360px]">
          <div className="mx-auto w-full max-w-[360px]">
            <div className="overflow-hidden rounded-[2rem] border-[6px] border-neutral-800 bg-white shadow-xl dark:border-neutral-700">
              <div className="flex h-[640px] flex-col overflow-y-auto">
                <PharmaProductRenderer
                  data={data}
                  removeBranding={plan !== "free"}
                  themePreset={themePreset}
                  heightClass="flex-1"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Styles for form inputs */}
      <style jsx global>{`
        .input-base {
          width: 100%;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
          background: #fff;
          padding: 6px 10px;
          font-size: 13px;
          color: #111827;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .input-base:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
        }
        .dark .input-base {
          background: hsl(var(--card));
          border-color: hsl(var(--border));
          color: hsl(var(--foreground));
        }
      `}</style>
    </div>
  );
}

function FieldSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </label>
      {children}
    </div>
  );
}
