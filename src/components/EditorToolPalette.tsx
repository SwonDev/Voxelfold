import { useEffect, useRef, useState } from "react";
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
      { id: "eraser", label: "Borrador", key: "2", icon: "tool-eraser" },
      { id: "replace", label: "Reemplazar", key: "3", icon: "tool-replace" },
      { id: "eyedrop", label: "Cuentagotas", key: "4", icon: "tool-eyedrop" },
      { id: "paint", label: "Pintar (arrastrar)", key: "5", icon: "tool-paint" },
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
  showShortcut = false,
}: {
  t: ToolDef;
  active: boolean;
  size: number;
  onClick: () => void;
  disabled?: boolean;
  disabledTitle?: string;
  showShortcut?: boolean;
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
      {showShortcut && t.key && (
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const isDisabled = (t: EditorTool) => t === "paste" && !canPaste;
  const pasteHint = "Pegar: primero copia o corta una selección";
  useEffect(() => {
    if (!advancedOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (railRef.current && !railRef.current.contains(event.target as Node)) setAdvancedOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAdvancedOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [advancedOpen]);

  if (orientation === "rail") {
    const primary = GROUPS[0].tools;
    const advancedGroups = GROUPS.slice(1);
    const activeAdvanced = advancedGroups.flatMap((group) => group.tools).find((item) => item.id === tool);
    return (
      <div ref={railRef} className="relative flex flex-col items-center gap-1.5 rounded-lg border border-line bg-surface/95 p-1.5 shadow-sm">
        {primary.map((t) => (
          <ToolButton
            key={t.id}
            t={t}
            active={tool === t.id}
            size={44}
            onClick={() => setTool(t.id)}
          />
        ))}
        <div className="my-0.5 h-px w-7 bg-line" aria-hidden />
        <button
          type="button"
          aria-expanded={advancedOpen}
          aria-haspopup="dialog"
          aria-label={activeAdvanced ? `Herramienta avanzada: ${activeAdvanced.label}` : "Más herramientas"}
          title={activeAdvanced ? `${activeAdvanced.label} · Más herramientas` : "Más herramientas"}
          onClick={() => setAdvancedOpen((value) => !value)}
          className={cn(
            "relative grid h-11 w-11 place-items-center rounded-md border transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            activeAdvanced
              ? "border-accent/60 bg-accent/25 text-ink"
              : "border-line bg-surface-2/50 text-muted hover:bg-elevated hover:text-ink",
          )}
        >
          <HyIcon name={activeAdvanced?.icon ?? "settings"} size={25} className={activeAdvanced ? "" : "opacity-85"} />
          <HyIcon
            name="forward"
            size={9}
            className={cn("absolute bottom-1 right-1 opacity-60 transition-transform", advancedOpen && "rotate-180")}
          />
        </button>

        {advancedOpen && (
          <div
            role="dialog"
            aria-label="Herramientas avanzadas"
            className="absolute left-full top-0 z-40 ml-2 w-52 rounded-[var(--radius)] border border-line bg-elevated p-2 shadow-md shadow-black/40"
          >
            {advancedGroups.map((group, index) => (
              <section key={group.title} className={cn(index > 0 && "mt-2 border-t border-line pt-2")}>
                <h3 className="mb-1 px-1 text-xs font-semibold text-muted">{group.title}</h3>
                <div className="space-y-0.5">
                  {group.tools.map((item) => {
                    const disabled = isDisabled(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={disabled}
                        aria-pressed={tool === item.id}
                        title={disabled ? pasteHint : item.label}
                        onClick={() => {
                          setTool(item.id);
                          setAdvancedOpen(false);
                        }}
                        className={cn(
                          "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-40",
                          tool === item.id ? "bg-accent/20 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
                        )}
                      >
                        <HyIcon name={item.icon} size={22} />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.key && <kbd className="font-mono text-[11px] text-muted">{item.key}</kbd>}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
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
                showShortcut
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
