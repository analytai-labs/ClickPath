"use client";

import {
  IconExternalLink,
  IconFlask,
  IconLayoutList,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { Link } from "next-view-transitions";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
import type { Plan } from "@/lib/billing/plans";
import { api } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/shared";

import { CreateBioPageDialog } from "../../bio-pages/_components/create-bio-page-dialog";
import { CreatePharmaPageDialog } from "./create-pharma-page-dialog";

type TemplatePage = RouterOutputs["templatePage"]["list"][number];

type TemplatesListProps = {
  pages: RouterOutputs["templatePage"]["list"];
  plan: Plan;
  templatePageLimit: number | null;
};

type FilterType = "all" | "bio" | "pharma_product";

const TEMPLATE_LABELS: Record<string, string> = {
  bio: "Bio Page",
  pharma_product: "Pharma Product",
};

const TEMPLATE_ICONS: Record<string, typeof IconLayoutList> = {
  bio: IconLayoutList,
  pharma_product: IconFlask,
};

function getEditorHref(page: TemplatePage): string {
  if (page.templateType === "pharma_product") {
    return `/dashboard/templates/pharma-product/${page.id}`;
  }
  return `/dashboard/bio-pages/${page.id}`;
}

export function TemplatesList({ pages, templatePageLimit }: TemplatesListProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterType>("all");
  const atLimit = templatePageLimit !== null && pages.length >= templatePageLimit;

  const deletePage = api.templatePage.delete.useMutation({
    onSuccess: () => {
      toast.success("Page deleted.");
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const filtered =
    filter === "all" ? pages : pages.filter((p) => p.templateType === filter);

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

        {pages.length > 0 &&
          (atLimit ? (
            <span
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-neutral-100 px-4 py-2 text-[13px] font-medium text-neutral-400 dark:bg-muted dark:text-neutral-500"
              title="You've reached your plan's template page limit."
            >
              <IconPlus size={16} stroke={2} />
              New template
            </span>
          ) : (
            <NewTemplateButton atLimit={atLimit} />
          ))}
      </div>

      {/* Filter tabs */}
      {pages.length > 0 && (
        <div className="mb-5 flex gap-2">
          {(["all", "bio", "pharma_product"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
                filter === f
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-muted dark:text-neutral-400 dark:hover:bg-muted/70"
              }`}
            >
              {f === "all" ? "All" : TEMPLATE_LABELS[f]}
              <span className="ml-1.5 opacity-70">
                {f === "all"
                  ? pages.length
                  : pages.filter((p) => p.templateType === f).length}
              </span>
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 && pages.length === 0 ? (
        <EmptyState atLimit={atLimit} />
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-neutral-400">
          No {TEMPLATE_LABELS[filter] ?? ""} pages yet.
        </div>
      ) : (
        <div className="divide-y divide-neutral-200/70 dark:divide-border">
          {filtered.map((page, index) => {
            const Icon = TEMPLATE_ICONS[page.templateType] ?? IconLayoutList;
            const href = getEditorHref(page);
            return (
              <motion.div
                key={page.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: Math.min(index, 6) * 0.05,
                  type: "spring",
                  duration: 0.4,
                  bounce: 0,
                }}
                className="flex items-center justify-between gap-4 py-4"
              >
                <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-muted">
                    <Icon size={18} stroke={1.5} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-neutral-900 dark:text-foreground">
                        {page.title || `/${page.slug}`}
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
                        {TEMPLATE_LABELS[page.templateType] ?? page.templateType}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-neutral-400 dark:text-neutral-500">
                      clickpath.analytai.in/p/{page.slug}
                    </span>
                  </span>
                </Link>

                <div className="flex shrink-0 items-center gap-1">
                  {page.isPublished && (
                    <a
                      href={`/p/${page.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="View live page"
                      className="rounded-md p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-muted"
                      title="View live page"
                    >
                      <IconExternalLink size={16} stroke={1.5} />
                    </a>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        aria-label="Delete page"
                        className="rounded-md p-2 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="Delete page"
                      >
                        <IconTrash size={16} stroke={1.5} />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this page?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the page and its analytics. This cannot be
                          undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-600 hover:bg-red-700"
                          onClick={() => deletePage.mutate({ id: page.id })}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewTemplateButton({ atLimit }: { atLimit: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={atLimit} className="gap-2">
          <IconPlus size={16} stroke={2} />
          New template
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <CreateBioPageDialog
          trigger={
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              className="cursor-pointer gap-3"
            >
              <IconLayoutList size={15} stroke={1.5} />
              <span>Bio Page</span>
            </DropdownMenuItem>
          }
        />
        <CreatePharmaPageDialog
          trigger={
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              className="cursor-pointer gap-3"
            >
              <IconFlask size={15} stroke={1.5} />
              <span>Pharma Product</span>
            </DropdownMenuItem>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyState({ atLimit }: { atLimit: boolean }) {
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
      {!atLimit && (
        <div className="mt-5">
          <NewTemplateButton atLimit={false} />
        </div>
      )}
    </div>
  );
}
