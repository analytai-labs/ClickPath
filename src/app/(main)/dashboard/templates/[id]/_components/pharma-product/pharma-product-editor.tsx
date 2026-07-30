"use client";

import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { PharmaProductRenderer } from "@/components/templates/pharma-product/renderer";
import { Button } from "@/components/ui/button";
import { ImageUploadTile } from "@/components/ui/image-upload-tile";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type PharmaProductData,
  normalizePharmaProductData,
} from "@/lib/templates/definitions/pharma-product";
import { getTemplateDefinition, resolveVariantId } from "@/lib/templates/registry";
import { api } from "@/trpc/react";

import { EditorCard, Field } from "../editor-ui";
import { TemplateEditorShell } from "../template-editor-shell";
import { VariantPicker } from "../variant-picker";

import type { TemplateEditorProps } from "../editor-types";

const MAX_PRODUCT_IMAGES = 10;
const MAX_DOCUMENTS = 20;

/** Stable keys for list rows, so removing an item never reshuffles React state. */
let rowKeySeq = 0;
const nextRowKey = () => `row-${++rowKeySeq}`;

export function PharmaProductEditor({ pageId, initialData, plan }: TemplateEditorProps) {
  const utils = api.useUtils();
  const { data } = api.templatePage.get.useQuery(
    { id: pageId },
    { initialData, refetchOnWindowFocus: false },
  );
  const page = data ?? initialData;
  const definition = getTemplateDefinition(page.templateType);

  const [content, setContent] = useState<PharmaProductData>(() =>
    normalizePharmaProductData(page.templateData),
  );
  const [imageKeys, setImageKeys] = useState<string[]>(() =>
    normalizePharmaProductData(page.templateData).productImages.map(nextRowKey),
  );
  const [documentKeys, setDocumentKeys] = useState<string[]>(() =>
    normalizePharmaProductData(page.templateData).documents.map(nextRowKey),
  );
  const [variantId, setVariantId] = useState(() =>
    resolveVariantId(definition, (page.theme as { preset?: string } | null)?.preset),
  );
  const [dirty, setDirty] = useState(false);

  const refresh = () => utils.templatePage.get.invalidate({ id: pageId });

  const save = api.templatePage.updateTemplateData.useMutation({
    onSuccess: () => {
      toast.success("Saved.");
      setDirty(false);
      void refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  function update<K extends keyof PharmaProductData>(key: K, value: PharmaProductData[K]) {
    setContent((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function setProductImages(images: string[], keys: string[]) {
    setImageKeys(keys);
    update("productImages", images);
  }

  function setDocuments(documents: PharmaProductData["documents"], keys: string[]) {
    setDocumentKeys(keys);
    update("documents", documents);
  }

  return (
    <TemplateEditorShell
      page={page}
      plan={plan}
      onChanged={refresh}
      save={{
        onSave: () => save.mutate({ id: pageId, data: content, theme: { preset: variantId } }),
        dirty,
        saving: save.isLoading,
      }}
      preview={
        <PharmaProductRenderer
          data={content}
          removeBranding={page.removeBranding ?? false}
          variantId={variantId}
        />
      }
      design={
        <EditorCard title="Style" description="Colour presets for the published product page.">
          <VariantPicker
            definition={definition}
            value={variantId}
            onChange={(id) => {
              setVariantId(id);
              setDirty(true);
            }}
          />
        </EditorCard>
      }
      content={
        <>
          <EditorCard title="Product">
            <div className="space-y-4">
              <Field label="Product name" htmlFor="pharma-name">
                <Input
                  id="pharma-name"
                  value={content.productName}
                  onChange={(e) => update("productName", e.target.value)}
                  placeholder="e.g. Amoxicillin 500mg Capsules"
                />
              </Field>
              <Field label="Composition" htmlFor="pharma-composition">
                <Textarea
                  id="pharma-composition"
                  rows={2}
                  value={content.composition}
                  onChange={(e) => update("composition", e.target.value)}
                  placeholder="e.g. Each capsule contains Amoxicillin 500mg"
                />
              </Field>
              <Field label="Overview" htmlFor="pharma-overview">
                <Textarea
                  id="pharma-overview"
                  rows={4}
                  value={content.productOverview}
                  onChange={(e) => update("productOverview", e.target.value)}
                  placeholder="Describe the product, indications, usage…"
                />
              </Field>
            </div>
          </EditorCard>

          <EditorCard title="Companies">
            <div className="grid gap-4 sm:grid-cols-2">
              <CompanyFields
                idPrefix="marketed"
                label="Marketed by"
                value={content.marketed}
                namePlaceholder="e.g. Acme Pharma Ltd."
                addressPlaceholder="City, State, Country"
                onChange={(marketed) => update("marketed", marketed)}
              />
              <CompanyFields
                idPrefix="manufactured"
                label="Manufactured by"
                value={content.manufactured}
                namePlaceholder="e.g. WHO-GMP Pharma Labs"
                addressPlaceholder="Manufacturing plant address"
                onChange={(manufactured) => update("manufactured", manufactured)}
              />
            </div>
          </EditorCard>

          <EditorCard title="Contact">
            <div className="space-y-4">
              <Field label="Contact person" htmlFor="pharma-contact-name">
                <Input
                  id="pharma-contact-name"
                  value={content.contact.name}
                  onChange={(e) => update("contact", { ...content.contact, name: e.target.value })}
                  placeholder="Sales / MR name"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="WhatsApp number" htmlFor="pharma-contact-whatsapp">
                  <Input
                    id="pharma-contact-whatsapp"
                    type="tel"
                    value={content.contact.whatsapp}
                    onChange={(e) =>
                      update("contact", { ...content.contact, whatsapp: e.target.value })
                    }
                    placeholder="+91 98765 43210"
                  />
                </Field>
                <Field label="Email" htmlFor="pharma-contact-email">
                  <Input
                    id="pharma-contact-email"
                    type="email"
                    value={content.contact.email}
                    onChange={(e) =>
                      update("contact", { ...content.contact, email: e.target.value })
                    }
                    placeholder="sales@company.com"
                  />
                </Field>
              </div>
            </div>
          </EditorCard>

          <EditorCard
            title="Product images"
            description={`Packshots shown in the carousel — PNG, JPEG or WebP, up to 2 MB each (max ${MAX_PRODUCT_IMAGES}).`}
          >
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {content.productImages.map((image, i) => (
                <ImageUploadTile
                  key={imageKeys[i] ?? `image-${i}`}
                  value={image}
                  ariaLabel={`Product image ${i + 1}`}
                  onChange={(val) => {
                    if (val === null) {
                      setProductImages(
                        content.productImages.filter((_, idx) => idx !== i),
                        imageKeys.filter((_, idx) => idx !== i),
                      );
                      return;
                    }
                    setProductImages(
                      content.productImages.map((img, idx) => (idx === i ? val : img)),
                      imageKeys,
                    );
                  }}
                />
              ))}
              {content.productImages.length < MAX_PRODUCT_IMAGES && (
                <ImageUploadTile
                  key={`add-${content.productImages.length}`}
                  value={null}
                  label={content.productImages.length === 0 ? "Front view" : "Add image"}
                  ariaLabel="Add product image"
                  onChange={(val) => {
                    if (!val) return;
                    setProductImages([...content.productImages, val], [...imageKeys, nextRowKey()]);
                  }}
                />
              )}
            </div>
          </EditorCard>

          <EditorCard
            title="Documents & literature"
            description="Visual aids and product literature — upload an image and label each one."
          >
            <div className="space-y-3">
              {content.documents.map((doc, i) => (
                <div
                  key={documentKeys[i] ?? `doc-${i}`}
                  className="flex gap-3 rounded-xl border border-neutral-200 p-3 dark:border-border"
                >
                  <ImageUploadTile
                    value={doc.imageUrl || null}
                    label="Upload"
                    ariaLabel={`Document image ${i + 1}`}
                    className="w-20 shrink-0"
                    onChange={(val) =>
                      setDocuments(
                        content.documents.map((d, idx) =>
                          idx === i ? { ...d, imageUrl: val ?? "" } : d,
                        ),
                        documentKeys,
                      )
                    }
                  />
                  <div className="flex flex-1 flex-col justify-between gap-2">
                    <Input
                      value={doc.name}
                      onChange={(e) =>
                        setDocuments(
                          content.documents.map((d, idx) =>
                            idx === i ? { ...d, name: e.target.value } : d,
                          ),
                          documentKeys,
                        )
                      }
                      placeholder="Label (e.g. Visual Aid, PI Sheet)"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDocuments(
                          content.documents.filter((_, idx) => idx !== i),
                          documentKeys.filter((_, idx) => idx !== i),
                        )
                      }
                      className="flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-[11px] text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <IconTrash size={13} stroke={1.5} /> Remove
                    </button>
                  </div>
                </div>
              ))}

              {content.documents.length < MAX_DOCUMENTS && (
                <Button
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={() =>
                    setDocuments(
                      [...content.documents, { imageUrl: "", name: "" }],
                      [...documentKeys, nextRowKey()],
                    )
                  }
                >
                  Add document
                </Button>
              )}
            </div>
          </EditorCard>
        </>
      }
    />
  );
}

function CompanyFields({
  idPrefix,
  label,
  value,
  namePlaceholder,
  addressPlaceholder,
  onChange,
}: {
  idPrefix: string;
  label: string;
  value: { name: string; address: string };
  namePlaceholder: string;
  addressPlaceholder: string;
  onChange: (value: { name: string; address: string }) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
      <Field label="Company name" htmlFor={`${idPrefix}-name`}>
        <Input
          id={`${idPrefix}-name`}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder={namePlaceholder}
        />
      </Field>
      <Field label="Address" htmlFor={`${idPrefix}-address`}>
        <Textarea
          id={`${idPrefix}-address`}
          rows={2}
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
          placeholder={addressPlaceholder}
        />
      </Field>
    </div>
  );
}
