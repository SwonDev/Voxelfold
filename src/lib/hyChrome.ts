import { uiAsset } from "@/lib/api";

/**
 * Inyecta las imágenes nine-patch REALES de la UI de Hytale como variables CSS en :root, resueltas
 * vía {@link uiAsset} (Tauri → `voxelfold-asset://`; dev/test → `/hytale/`). Se llama UNA vez al
 * arrancar la app. Así la UI nativa (botones, paneles, cabeceras, tooltips, slots, checkboxes…) se ve
 * IGUAL en la app real y en el navegador de verificación, desde una única fuente. Si un asset no
 * carga, el CSS cae a su `background-color`/borde de respaldo. NO empaqueta nada: las imágenes se
 * leen bajo demanda del `Assets.zip` local del usuario (BYO), nunca se redistribuyen.
 */
const HY_CHROME: Record<string, string> = {
  "--hy-img-btn-primary": "Buttons/Primary@2x.png",
  "--hy-img-btn-primary-hover": "Buttons/Primary_Hovered@2x.png",
  "--hy-img-btn-primary-active": "Buttons/Primary_Pressed@2x.png",
  "--hy-img-btn-secondary": "Buttons/Secondary@2x.png",
  "--hy-img-btn-secondary-hover": "Buttons/Secondary_Hovered@2x.png",
  "--hy-img-btn-secondary-active": "Buttons/Secondary_Pressed@2x.png",
  "--hy-img-btn-tertiary": "Buttons/Tertiary@2x.png",
  "--hy-img-btn-tertiary-hover": "Buttons/Tertiary_Hovered@2x.png",
  "--hy-img-btn-destructive": "Buttons/Destructive@2x.png",
  "--hy-img-btn-destructive-hover": "Buttons/Destructive_Hovered@2x.png",
  "--hy-img-panel": "ContainerFullPatch@2x.png",
  "--hy-img-header": "ContainerHeader@2x.png",
  "--hy-img-tooltip": "TooltipDefaultBackground@2x.png",
  "--hy-img-separator": "ContainerSectionSeparator@2x.png",
  // Nuevos: slot de inventario de Hytale (paleta de bloques) y checkbox nativa.
  "--hy-img-slot": "BlockSelectorSlotBackground@2x.png",
  "--hy-img-check": "CheckBoxFrame@2x.png",
  "--hy-img-checkmark": "Checkmark@2x.png",
};

let installed = false;

export function installHyChrome(force = false): void {
  if (installed && !force) return;
  installed = true;
  const root = document.documentElement;
  for (const [varName, path] of Object.entries(HY_CHROME)) {
    root.style.setProperty(varName, `url("${uiAsset(path)}")`);
  }
}
