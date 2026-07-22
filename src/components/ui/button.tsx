import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Usa la piel de botones REAL de Hytale (clases .hy-btn-* en index.css).
const buttonVariants = cva(
  "hy-btn text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "hy-btn-primary",
        secondary: "hy-btn-secondary",
        ghost: "hy-btn-tertiary",
        danger: "hy-btn-destructive",
      },
      size: {
        sm: "min-h-[34px] px-3 text-sm",
        md: "",
        lg: "hy-btn-lg",
        icon: "min-h-[40px] w-10 px-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
