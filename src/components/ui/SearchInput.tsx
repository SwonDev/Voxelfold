import { useId, type Ref } from "react";
import { HyIcon } from "@/components/HyIcon";
import { cn } from "@/lib/utils";

/**
 * Barra de búsqueda unificada (antes repetida en Library, Community, Import, Blocks y
 * EditMaterialsDialog). Incluye `<label>` accesible (sr-only) y anillo de foco visible.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  onEnter,
  className,
  autoFocus,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
  onEnter?: () => void;
  className?: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[var(--radius)] border border-line bg-surface px-3 py-2 focus-within:ring-2 focus-within:ring-accent/50",
        className,
      )}
    >
      <HyIcon name="search" size={18} />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnter ? (e) => e.key === "Enter" && onEnter() : undefined}
        placeholder={placeholder}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        className="w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
      />
    </div>
  );
}
