import { assetUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Iconos NATIVOS de Hytale (servidos en local por voxelfold-asset://).
 * Cada nombre lógico apunta a un asset real del juego; `rot` rota el icono.
 * `mask: true` → el icono (glyph blanco con alfa, p. ej. ItemCategories) se renderiza como
 * MÁSCARA CSS teñida con `currentColor` → hereda el color del tema (muted/ink/acento) para una nav
 * nítida y consistente, en vez de un PNG blanco fijo. Los iconos a color (renders de objeto) van como <img>.
 */
const HY_ICONS = {
  library: { src: "Common/Icons/ItemCategories/Build-Roofs.png", mask: true }, // casa = biblioteca
  shelves: { src: "Common/Icons/ItemCategories/Shelves.png", mask: true },
  blocks: { src: "Common/Icons/ItemCategories/Blocks.png", mask: true },
  community: { src: "Common/Icons/ItemCategories/Hypixel.png", mask: true }, // comunidad
  prefab: { src: "Common/UI/WorldMap/MapMarkers/Prefab.png" }, // importar prefabs de Hytale
  portal: { src: "Common/Icons/ItemCategories/Portal.png", mask: true },
  home: { src: "Common/UI/WorldMap/MapMarkers/Home.png" },
  recipe: { src: "Common/Icons/ItemCategories/Items-Recipe.png", mask: true }, // colección curada
  editor: { src: "Common/Icons/ItemCategories/Editor.png", mask: true },
  favorites: { src: "Common/Icons/ItemCategories/Container.png", mask: true }, // tu colección
  search: { src: "Common/UI/Custom/Common/SearchIcon@2x.png", mask: true },
  back: { src: "Common/UI/Custom/Common/ContainerTitleArrow@2x.png", rot: 180 }, // ◄ izquierda
  forward: { src: "Common/UI/Custom/Common/ContainerTitleArrow@2x.png", rot: 0 }, // ► derecha
  build: { src: "Common/Icons/ItemCategories/Build-Walls.png", mask: true },
  roofs: { src: "Common/Icons/ItemCategories/Build-Roofs.png", mask: true },
  stairs: { src: "Common/Icons/ItemCategories/Build-Stairs.png", mask: true },
  settings: { src: "Common/Icons/ItemCategories/Items-Tools.png", mask: true }, // llave = ajustes
  close: { src: "Common/UI/Custom/Common/ContainerCloseButton@2x.png" },
  check: { src: "Common/UI/Custom/Common/Checkmark@2x.png", mask: true },
  bench: { src: "Common/Icons/ItemCategories/Bench.png", mask: true },

  // --- Herramientas del editor: iconos NATIVOS del editor de Hytale (Common/Icons/Items/EditorTools) ---
  "tool-place": { src: "Common/Icons/ItemsGenerated/Build_GreyLight_Cube.png" },
  "tool-paint": { src: "Common/Icons/Items/EditorTools/Paint.png" },
  "tool-eraser": { src: "Common/Icons/Items/EditorTools/Laser.png" },
  "tool-replace": { src: "Common/Icons/Items/EditorTools/Tint.png" },
  "tool-eyedrop": { src: "Common/UI/Custom/Common/ColorPickerButton@2x.png" },
  "tool-line": { src: "Common/Icons/Items/EditorTools/Line.png" },
  "tool-rect": { src: "Common/Icons/Items/EditorTools/Extrude.png" },
  "tool-fill": { src: "Common/Icons/Items/EditorTools/Flood.png" },
  "tool-brush": { src: "Common/Icons/Items/EditorTools/Sculpt.png" },
  "tool-select": { src: "Common/Icons/Items/EditorTools/Selection.png" },
  "tool-paste": { src: "Common/Icons/Items/EditorTools/Paste.png" },

  // --- Acciones del editor (iconos nativos) ---
  undo: { src: "Common/UI/Custom/Common/ContainerTitleArrow@2x.png", rot: 180 },
  redo: { src: "Common/UI/Custom/Common/ContainerTitleArrow@2x.png", rot: 0 },
  trash: { src: "Common/Icons/AssetNotifications/Trash@2x.png" },
  layers: { src: "Common/Icons/Items/EditorTools/Layers.png" },
  rotate: { src: "Common/Icons/Items/EditorTools/Revolve.png" },
  ruler: { src: "Common/Icons/Items/EditorTools/Ruler.png" },
} as const;

export type HyIconName = keyof typeof HY_ICONS;

export function HyIcon({
  name,
  size = 20,
  className,
}: {
  name: HyIconName;
  size?: number;
  className?: string;
}) {
  const icon = HY_ICONS[name];
  const rot = "rot" in icon ? icon.rot : 0;
  const url = assetUrl(icon.src);
  const transform = rot ? `rotate(${rot}deg)` : undefined;

  // Glyph blanco → máscara CSS teñida con currentColor (hereda el color del tema → nav consistente).
  if ("mask" in icon && icon.mask) {
    return (
      <span
        aria-hidden
        className={cn("inline-block shrink-0", className)}
        style={{
          width: size,
          height: size,
          transform,
          backgroundColor: "currentColor",
          WebkitMaskImage: `url("${url}")`,
          maskImage: `url("${url}")`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
      />
    );
  }

  // Icono a color (render de objeto) → imagen tal cual.
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      className={cn("inline-block shrink-0 object-contain", className)}
      style={{ width: size, height: size, transform }}
    />
  );
}
