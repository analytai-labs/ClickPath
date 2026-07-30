"use client";

import { IconExternalLink, IconLayoutList, IconPlus, IconTrash } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { Link } from "next-view-transitions";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { templateIcon, templateIconFor } from "@/components/templates/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { templatePageDisplayUrl, templatePagePreviewPath } from "@/lib/templates/page-url";
import {
  getTemplateDefinition,
  listTemplateDefinitions,
  templateEditorPath,
} from "@/lib/templates/registry";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

import { CreateTemplateDialog } from "./create-template-dialog";

import type { AnyTemplateDefinition } from "@/lib/templates/registry";
import type { RouterOutputs } from "@/trpc/shared";

type TemplatePageRow = RouterOutputs["templatePage"]["list"][number];

type TemplatesListProps = {
  pages: RouterOutputs["templatePage"]["list"];
  templatePageLimit: number | null;
};

const DEFINITIONS = listTemplateDefinitions();

export function TemplatesList({ pages, templatePageLimit }: TemplatesListProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [creating, setCreating] = useState<AnyTemplateDefinition | null>(null);
  const atLimit = templatePageLimit !== null && pages.length >= templatePageLimit;

  const deletePage = api.templatePage.delete.useMutation({
    onSuccess: () => {
      toast.success("Page deleted.");
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const filtered = filter === "all" ? pages : pages.filter((p) => p.templateType === filter);
  const filters = [
    { id: "all", label: "All", count: pages.length },
    ...DEFINITIONS.map((d) => ({
      id: d.id as string,
      label: d.label,
      count: pages.filter((p) => p.templateType === d.id).length,
    })),
  ];

  const newTemplateButton = (
    <NewTemplateMenu atLimit={atLimit} onSelect={(definition) => setCreating(definition)} />
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-foreground">
            Templates
          </h2>
          <p className="mt-1 text-[13px] text-neutral-400 dark:text-neutral-500">
            Shareable pages for your brand — link-in-bio, product showcases, and more.
          </p>
        </div>
        {pages.length > 0 && newTemplateButton}
      </div>

      {/* Filter tabs — one per registered template */}
      {pages.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
                filter === f.id
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-muted dark:text-neutral-400 dark:hover:bg-muted/70",
              )}
            >
              {f.label}
              <span className="ml-1.5 opacity-70">{f.count}</span>
            </button>
          ))}
        </div>
      )}

      {pages.length === 0 ? (
        <EmptyState action={atLimit ? null : newTemplateButton} />
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-neutral-400">
          No {getTemplateDefinition(filter).label} pages yet.
        </div>
      ) : (
        <div className="divide-y divide-neutral-200/70 dark:divide-border">
          {filtered.map((page, index) => (
            <TemplateRow
              key={page.id}
              page={page}
              index={index}
              onDelete={() => deletePage.mutate({ id: page.id })}
            />
          ))}
        </div>
      )}

      <CreateTemplateDialog
        definition={creating}
        open={creating !== null}
        onOpenChange={(open) => !open && setCreating(null)}
      />
    </div>
  );
}

function TemplateRow({
  page,
  index,
  onDelete,
}: {
  page: TemplatePageRow;
  index: number;
  onDelete: () => void;
}) {
  const definition = getTemplateDefinition(page.templateType);
  const Icon = templateIconFor(page.templateType);
  // Show where the page actually lives; open it same-origin, since a customer
  // domain may not resolve to this deployment.
  const previewPath = templatePagePreviewPath(page);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 6) * 0.05, type: "spring", duration: 0.4, bounce: 0 }}
      className="flex items-center justify-between gap-4 py-4"
    >
      <Link href={templateEditorPath(page.id)} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-muted">
          <Icon size={18} stroke={1.5} />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[14px] font-medium text-neutral-900 dark:text-foreground">
              {page.displayTitle || `/${page.slug}`}
            </span>
            {page.isPublished ? (
              <Badge
                variant="secondary"
                className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
              >
                Live
              </Badge>
            ) : (
              <Badge variant="secondary">Draft</Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              {definition.label}
            </Badge>
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-neutral-400 dark:text-neutral-500">
            {templatePageDisplayUrl(page)}
          </span>
        </span>
      </Link>

      <div className="flex shrink-0 items-center gap-1">
        {page.isPublished && (
          <a
            href={previewPath}
            target="_blank"
            rel="noreferrer"
            aria-label="View live page"
            title="View live page"
            className="rounded-md p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-muted"
          >
            <IconExternalLink size={16} stroke={1.5} />
          </a>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              aria-label="Delete page"
              title="Delete page"
              className="rounded-md p-2 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <IconTrash size={16} stroke={1.5} />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this page?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the page, its content and its analytics. This cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={onDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </motion.div>
  );
}

function NewTemplateMenu({
  atLimit,
  onSelect,
}: {
  atLimit: boolean;
  onSelect: (definition: AnyTemplateDefinition) => void;
}) {
  if (atLimit) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-neutral-100 px-4 py-2 text-[13px] font-medium text-neutral-400 dark:bg-muted dark:text-neutral-500"
        title="You've reached your plan's template page limit."
      >
        <IconPlus size={16} stroke={2} />
        New template
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="gap-2">
          <IconPlus size={16} stroke={2} />
          New template
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {DEFINITIONS.map((definition) => {
          const Icon = templateIcon(definition.iconKey);
          return (
            <DropdownMenuItem
              key={definition.id}
              onSelect={() => onSelect(definition)}
              className="cursor-pointer items-start gap-3 py-2"
            >
              <Icon size={16} stroke={1.5} className="mt-0.5 shrink-0 text-neutral-500" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{definition.label}</span>
                <span className="block text-[11px] leading-snug text-neutral-400 dark:text-neutral-500">
                  {definition.description}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyState({ action }: { action: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 py-16 text-center dark:border-border">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-muted">
        <IconLayoutList size={22} stroke={1.5} />
      </span>
      <h3 className="mt-4 text-[15px] font-medium text-neutral-900 dark:text-foreground">
        Create your first template page
      </h3>
      <p className="mt-1 max-w-sm text-[13px] text-neutral-400 dark:text-neutral-500">
        Bio pages, product showcases, and more — every view is tracked through your analytics.
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
