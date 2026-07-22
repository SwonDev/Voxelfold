import * as React from "react";
import { cn } from "@/lib/utils";

// Panel con la piel REAL de Hytale (nine-patch .hy-panel en index.css).
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("hy-panel", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-lg text-ink", className)} {...props} />;
}
