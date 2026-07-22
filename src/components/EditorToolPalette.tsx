import { cn } from "@/lib/utils";
import { HyIcon, type HyIconName } from "@/components/HyIcon";
import type { EditorTool } from "@/components/VoxelEditor";

interface ToolDef {
  id: EditorTool;
  label: string;
  key?: string;
  icon: HyIconName;
}

// Iconos NATIVOS del editor de Hytale (Common/Icons/Items/EditorTools) mapeados a cada herramienta.
const GROUPS: { title: string; tools: ToolDef[] }[] = [
  {
    title: "Bloque",
    tools: [
      { id: "place", label: "Colocar", key: "1", icon: "tool-place" },
      { id: "paint", label: "Pintar (arrastrar)", key: "5", icon: "tool-paint" },
      { id: "eraser", label: "Borrador", key: "2", icon: "tool-eraser" },
      { id: "replace", label: "Reemplazar", key: "3", icon: "tool-replace" },
      { id: "eyedrop", label: "Cuentagotas", key: "4", icon: "tool-eyedrop" },
    ],
  },
  {
    title: "Formas",
    tools: [
      { id: "line", label: "Línea / muro", key: "6", icon: "tool-line" },
      { id: "rect", label: "Caja", key: "7", icon: "tool-rect" },
      { id: "fill", label: "Rellenar", key: "8", icon: "tool-fill" },
      { id: "brush", label: "Brocha", key: "9", icon: "tool-brush" },
    ],
  },
  {
    title: "Selección",
    tools: [
      { id: "select", label: "Seleccionar", icon: "tool-select" },
      { id: "paste", label: "Pegar", key: "V", icon: "tool-paste" },
    ],
  },
];

/** Etiqueta legible de cada herramienta (deriva de GROUPS; reutilizada en el header del editor). */
export const TOOL_LABELS = Object.fromEntries(
  GROUPS.flatMap((g) => g.tools.map((t) => [t.id, t.label])),
) as Record<EditorTool, string>;

function ToolButton({
  t,
  active,
  size,
  onClick,
  disabled,
  disabledTitle,
}: {
  t: ToolDef;
  active: boolean;
  size: number;
  onClick: () => void;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledTitle ?? t.label : t.key ? `${t.label} · ${t.key}` : t.label}
      aria-label={t.label}
      aria-pressed={active}
      className={cn(
        "relative grid cursor-pointer place-items-center rounded-md border transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface-2/50",
        active
          ? "border-accent/60 bg-accent/25 text-ink shadow-sm"
          : "border-line bg-surface-2/50 text-muted hover:bg-elevated hover:text-ink",
      )}
      style={{ width: size, height: size }}
    >
      <HyIcon name={t.icon} size={Math.round(size * 0.56)} className={active ? "" : "opacity-85"} />
      {t.key && (
        <span className="pointer-events-none absolute right-1 top-0.5 text-[9px] leading-none text-muted">
          {t.key}
        </span>
      )}
    </button>
  );
}

/** Paleta visual de herramientas. `rail` = columna flotante compacta sobre el lienzo
 *  (separadores entre grupos); `grid` = rejilla con títulos para el panel lateral.
 *  Iconos SVG, atajos, estado activo y accesibilidad (aria-pressed, foco, target ≥40px). */
export function EditorToolPalette({
  tool,
  setTool,
  orientation = "rail",
  canPaste = true,
}: {
  tool: EditorTool;
  setTool: (t: EditorTool) => void;
  orientation?: "grid" | "rail";
  /** Si false, la herramienta «Pegar» se deshabilita (no hay portapapeles). */
  canPaste?: boolean;
}) {
  const isDisabled = (t: EditorTool) => t === "paste" && !canPaste;
  const pasteHint = "Pegar: primero copia o corta una selección";
  if (orientation === "rail") {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-xl border border-line bg-surface/90 p-1.5 shadow-lg backdrop-blur">
        {GROUPS.map((g, gi) => (
          <div key={g.title} className="flex flex-col items-center gap-1.5">
            {gi > 0 && <div className="my-0.5 h-px w-7 bg-line" aria-hidden />}
            {g.tools.map((t) => (
              <ToolButton
                key={t.id}
                t={t}
                active={tool === t.id}
                size={44}
                onClick={() => setTool(t.id)}
                disabled={isDisabled(t.id)}
                disabledTitle={pasteHint}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">{g.title}</p>
          <div className="grid grid-cols-5 gap-1.5">
            {g.tools.map((t) => (
              <ToolButton
                key={t.id}
                t={t}
                active={tool === t.id}
                size={44}
                onClick={() => setTool(t.id)}
                disabled={isDisabled(t.id)}
                disabledTitle={pasteHint}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
