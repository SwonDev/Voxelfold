import { assetUrl, blockIconUrl, type BlockInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

type BlockLike = Pick<BlockInfo, "icon" | "name" | "display_name" | "fallback_color">;

interface BlockIconProps {
  block: BlockLike;
  size?: number;
  className?: string;
}

/** Icono REAL del bloque (servido desde el Assets.zip local). Fallback al color del bloque. */
export function BlockIcon({ block, size = 40, className }: BlockIconProps) {
  const url = blockIconUrl(block);
  const alt = block.display_name ?? block.name;

  if (!url) {
    return (
      <div
        className={cn("rounded", className)}
        style={{ width: size, height: size, background: block.fallback_color ?? "#3a2e22" }}
        title={alt}
      />
    );
  }

  return (
    <img
      src={url}
      width={size}
      height={size}
      alt={alt}
      title={alt}
      loading="lazy"
      className={cn(className)}
      style={{ imageRendering: "pixelated", width: size, height: size }}
    />
  );
}

/** Icono del bloque dentro de un slot de inventario REAL de Hytale. */
export function SlotIcon({ block, size = 48, className }: BlockIconProps) {
  const slotUrl = assetUrl("Common/UI/ItemQualities/Slots/SlotDefault@2x.png");
  return (
    <div
      className={cn("grid shrink-0 place-items-center", className)}
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${slotUrl}")`,
        backgroundSize: "100% 100%",
        imageRendering: "pixelated",
      }}
      title={block.display_name ?? block.name}
    >
      <BlockIcon block={block} size={Math.round(size * 0.72)} />
    </div>
  );
}
