import { type LucideIcon } from "lucide-react";
import Link from "next/link";
import { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  actionOnClick,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  actionOnClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-xl border border-dashed bg-muted/20">
      {Icon ? (
        <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-primary/10 border border-primary/10 mb-4">
          <Icon className="size-7 text-primary" />
        </div>
      ) : null}
      <h3 className="text-lg font-semibold">{title}</h3>
      {description ? (
        <p className="text-sm text-muted-foreground mt-2 max-w-md">{description}</p>
      ) : null}
      {actionLabel && actionHref ? (
        <Link
          href={actionHref}
          className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {actionLabel}
        </Link>
      ) : actionLabel && actionOnClick ? (
        <button
          type="button"
          onClick={actionOnClick}
          className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {actionLabel}
        </button>
      ) : null}
      {children}
    </div>
  );
}
