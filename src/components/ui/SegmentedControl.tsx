import { cn } from "@/lib/utils";
import { HyIcon, type HyIconName } from "@/components/HyIcon";

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: HyIconName;
}

/**
 * Control segmentado (pestañas tipo "pill"). Sirve para mostrar UNA fuente/sección
 * a la vez en lugar de apilarlas todas y saturar la pantalla.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  segments,
  className,
  label,
  fluid = false,
}: {
  value: T;
  onChange: (v: T) => void;
  segments: Segment<T>[];
  className?: string;
  label?: string;
  /** Ocupa todo el ancho con segmentos de igual tamaño (para barras de pestañas). */
  fluid?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "gap-1 rounded-[var(--radius)] border border-line bg-surface p-1",
        fluid ? "flex w-full" : "inline-flex flex-wrap",
        className,
      )}
    >
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(s.value)}
            className={cn(
              "flex items-center gap-2 rounded-[8px] px-3.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              fluid && "flex-1 justify-center",
              active
                ? "bg-accent/20 text-accent-hi"
                : "text-muted hover:bg-surface-2/60 hover:text-ink",
            )}
          >
            {s.icon && <HyIcon name={s.icon} size={18} />}
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
