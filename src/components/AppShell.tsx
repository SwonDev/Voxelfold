import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { HyIcon, type HyIconName } from "@/components/HyIcon";
import { Tooltip } from "@/components/HyPanel";
import { Onboarding } from "@/components/Onboarding";

function NavItem({
  to,
  icon,
  label,
  collapsed,
}: {
  to: string;
  icon: HyIconName;
  label: string;
  collapsed: boolean;
}) {
  const link = (
    <NavLink
      to={to}
      end
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center rounded-[10px] text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          collapsed ? "h-11 w-11 justify-center" : "w-full gap-3 px-3 py-2.5",
          isActive
            ? "bg-accent/20 font-semibold text-ink shadow-sm shadow-black/20"
            : "text-muted hover:bg-surface-2/70 hover:text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Indicador de acento del item activo (barra lateral expandido / punto colapsado). */}
          {isActive && (
            <span
              aria-hidden
              className={cn(
                "absolute rounded-full bg-accent-hi",
                collapsed
                  ? "bottom-1 left-1/2 h-[3px] w-5 -translate-x-1/2"
                  : "left-0 top-1/2 h-5 w-[3px] -translate-y-1/2",
              )}
            />
          )}
          <HyIcon
            name={icon}
            size={22}
            className={cn("transition-opacity", isActive ? "opacity-100" : "opacity-70 group-hover:opacity-100")}
          />
          {!collapsed && <span className="truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip label={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

export function AppShell() {
  const location = useLocation();
  const ready = useQuery({ queryKey: ["hytale_ready"], queryFn: api.hytaleReady });
  const [skipped, setSkipped] = useState(false);
  const [preferredCollapsed, setPreferredCollapsed] = useState(
    () => localStorage.getItem("vf_sidebar_collapsed") === "true",
  );
  const [focusExpanded, setFocusExpanded] = useState(false);
  const focusMode = /\/(editor|guide)$/.test(location.pathname);
  const collapsed = focusMode ? !focusExpanded : preferredCollapsed;

  // Editor y guía son superficies de concentración: ganan lienzo al entrar, pero el usuario
  // puede expandir la navegación durante esa visita con el mismo botón o Ctrl/⌘+B.
  useEffect(() => setFocusExpanded(false), [location.pathname]);

  const toggle = useCallback(() => {
    if (focusMode) {
      setFocusExpanded((expanded) => !expanded);
      return;
    }
    setPreferredCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("vf_sidebar_collapsed", String(next));
      } catch {
        /* cuota llena: ignorar */
      }
      return next;
    });
  }, [focusMode]);

  // Atajo estándar de escritorio (VS Code/Linear): Ctrl/⌘+B colapsa la barra lateral.
  // Se ignora si el foco está en un campo de texto (no robar la pulsación al usuario).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "b") return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const showOnboarding = !ready.isLoading && ready.data === false && !skipped;

  const toggleBtn = (
    <button
      onClick={toggle}
      aria-label={collapsed ? "Expandir barra lateral (Ctrl+B)" : "Colapsar barra lateral (Ctrl+B)"}
      aria-expanded={!collapsed}
      title={collapsed ? "Expandir (Ctrl+B)" : "Colapsar (Ctrl+B)"}
      className={cn(
        "flex items-center rounded-[8px] text-sm text-muted transition-colors hover:bg-surface-2/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        collapsed ? "h-11 w-11 justify-center" : "w-full gap-3 px-3 py-2.5",
      )}
    >
      <HyIcon name={collapsed ? "forward" : "back"} size={20} />
      {!collapsed && <span>Colapsar</span>}
    </button>
  );

  return (
    <div className="hy-app-bg flex h-full">
      <aside
        aria-label="Navegación principal"
        className={cn(
          "hy-sidebar flex shrink-0 flex-col border-r border-line/80 transition-[width] duration-200 ease-in-out",
          collapsed ? "w-[68px]" : "w-60",
        )}
      >
        {/* Marca: logo siempre; título solo expandido. */}
        <div
          className={cn(
            "flex items-center py-5",
            collapsed ? "justify-center px-2" : "gap-3 px-4",
          )}
        >
          <img
            src="/brand/voxelfold-icon.png"
            alt="Voxelfold"
            className="h-11 w-11 shrink-0 rounded-xl shadow-md shadow-black/40"
            draggable={false}
          />
          {!collapsed && (
            <div className="leading-tight">
              <div className="font-display text-2xl text-ink">Voxelfold</div>
              <div className="text-xs text-muted">Guías de construcción para Hytale</div>
            </div>
          )}
        </div>

        <nav
          aria-label="Secciones"
          className={cn(
            "flex-1",
            collapsed ? "flex flex-col items-center gap-1 px-2" : "space-y-1 px-2",
          )}
        >
          <NavItem to="/" icon="library" label="Biblioteca" collapsed={collapsed} />
          <NavItem to="/blocks" icon="blocks" label="Bloques de Hytale" collapsed={collapsed} />
          <NavItem to="/community" icon="community" label="Comunidad" collapsed={collapsed} />
          <NavItem to="/import" icon="portal" label="Importar de Hytale" collapsed={collapsed} />
          <NavItem to="/favorites" icon="favorites" label="Favoritos" collapsed={collapsed} />
          <NavItem to="/settings" icon="settings" label="Ajustes" collapsed={collapsed} />
        </nav>

        {/* Botón de colapso */}
        <div className={cn("py-1", collapsed ? "flex justify-center px-2" : "px-2")}>
          {collapsed ? (
            <Tooltip label="Expandir (Ctrl+B)" side="right">
              {toggleBtn}
            </Tooltip>
          ) : (
            toggleBtn
          )}
        </div>

        {/* Estado de conexión con Hytale */}
        <div
          className={cn(
            "border-t border-line/80 text-xs",
            collapsed ? "flex justify-center px-2 py-3" : "p-4",
          )}
        >
          {ready.isLoading ? (
            collapsed ? (
              <Tooltip label="Detectando Hytale…" side="right">
                <span className="text-muted" aria-label="Detectando Hytale">
                  ●
                </span>
              </Tooltip>
            ) : (
              <span className="text-muted">Detectando Hytale…</span>
            )
          ) : ready.data ? (
            collapsed ? (
              <Tooltip label="Hytale conectado" side="right">
                <span className="text-accent-hi" aria-label="Hytale conectado">
                  ●
                </span>
              </Tooltip>
            ) : (
              <span className="text-accent-hi">● Hytale conectado</span>
            )
          ) : (
            <button
              onClick={() => setSkipped(false)}
              aria-label="Hytale no detectado: abrir la configuración de la instalación"
              className="rounded text-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {collapsed ? (
                <Tooltip label="Hytale no detectado" side="right">
                  <span aria-hidden>●</span>
                </Tooltip>
              ) : (
                "● Hytale no detectado"
              )}
            </button>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        {showOnboarding ? <Onboarding onSkip={() => setSkipped(true)} /> : <Outlet />}
      </main>
    </div>
  );
}
