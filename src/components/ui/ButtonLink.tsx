import { Link, type LinkProps } from "react-router-dom";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/** Enlace de router con la piel del Button (para acciones de navegación que parecen botón). */
export function ButtonLink({
  className,
  variant,
  size,
  ...props
}: LinkProps & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
