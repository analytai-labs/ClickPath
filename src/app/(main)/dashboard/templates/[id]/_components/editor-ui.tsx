import { cn } from "@/lib/utils";

/**
 * Surface primitives shared by every template editor, so the Content, Design
 * and Settings tabs sit on the same card background instead of floating on the
 * dashboard's page fill.
 */
export function EditorCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-neutral-200 bg-white p-5 dark:border-border dark:bg-card",
        className,
      )}
    >
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && (
              <h3 className="text-[13px] font-semibold text-neutral-900 dark:text-foreground">
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-0.5 text-[12px] text-neutral-400 dark:text-neutral-500">
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
      >
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{hint}</p>}
    </div>
  );
}

/** A labelled control row, e.g. a switch or a select on the right of its label. */
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <span className="flex items-center gap-1.5 text-[13px] text-neutral-700 dark:text-foreground">
          {label}
        </span>
        {hint && (
          <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">{hint}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
