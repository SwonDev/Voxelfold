import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type BlockInfo } from "@/lib/api";

/** Catálogo de bloques como mapa `block_name → BlockInfo` (cacheado por React Query). */
export function useCatalogMap() {
  const { data } = useQuery({ queryKey: ["catalog"], queryFn: api.getBlockCatalog });
  return useMemo(() => {
    const map = new Map<string, BlockInfo>();
    data?.forEach((b) => map.set(b.name, b));
    return map;
  }, [data]);
}
