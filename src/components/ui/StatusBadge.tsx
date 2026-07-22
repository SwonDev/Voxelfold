import type { BuildStatus } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

/** Insignia de estado de una build, consistente en Biblioteca, Favoritos y Ficha. */
export function StatusBadge({ status }: { status: BuildStatus }) {
  if (status === "completed") return <Badge variant="accent">Completada</Badge>;
  if (status === "in_progress") return <Badge variant="gold">En progreso</Badge>;
  return null;
}
