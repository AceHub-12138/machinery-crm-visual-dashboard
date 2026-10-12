import type { ReactNode } from "react";
/** Visible excerpt and full accessible name share one explicit compensation boundary. */
export function ClipText({ full, children, className = "clip-1" }: { full: string; children?: ReactNode; className?: string }) {
  return <span className={className} title={full}><span aria-hidden="true">{children ?? full}</span><span className="sr-only">{full}</span></span>;
}
