import { lazy, Suspense } from "react";
import type { BlockInfo, StoredModel } from "@/lib/api";

// Carga diferida del visor (Three.js) para no inflar el bundle inicial.
const VoxelViewerInner = lazy(() =>
  import("@/components/VoxelViewer").then((m) => ({ default: m.VoxelViewer })),
);

interface Props {
  model: StoredModel;
  catalog: Map<string, BlockInfo>;
  visibleUpToPhase: number;
  highlightPhase?: number | null;
  ghost?: boolean;
  cameraKey?: string;
  layerY?: number | null;
  layerMode?: "all" | "upTo" | "only";
  focusBlock?: string | null;
  presentation?: "build" | "object";
}

export function VoxelViewerLazy(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-muted">Cargando visor 3D…</div>
      }
    >
      <VoxelViewerInner {...props} />
    </Suspense>
  );
}
