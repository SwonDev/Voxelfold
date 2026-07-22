import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { BuildCard } from "@/components/BuildCard";
import { BuildGridSkeleton } from "@/components/ui/Skeleton";
import { HyIcon } from "@/components/HyIcon";
import { useCatalogMap } from "@/lib/useCatalog";
import { errorMessage } from "@/lib/errorMessage";

export function Favorites() {
  const catalog = useCatalogMap();
  const { data: builds, isLoading, error } = useQuery({
    queryKey: ["build_summaries"],
    queryFn: api.listBuildSummaries,
  });

  const favBuilds = (builds ?? []).filter((b) => b.is_favorite);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-8 py-8">
      <PageHeader
        title="Favoritos"
        subtitle="Tus builds guardadas para volver cuando quieras."
      />

      {isLoading ? (
        <BuildGridSkeleton count={4} />
      ) : error ? (
        <p className="text-sm text-danger" role="alert">
          {errorMessage(error)}
        </p>
      ) : favBuilds.length === 0 ? (
        <div className="mx-auto flex max-w-xl flex-col items-center justify-center rounded-[var(--radius)] border border-dashed border-line py-20 text-center">
          <HyIcon name="favorites" size={44} className="mb-4 opacity-80" />
          <p className="mb-6 text-sm text-muted">
            Aún no has guardado ninguna build. Pulsa <span className="text-ink">Guardar</span> en la
            ficha de cualquier construcción.
          </p>
          <ButtonLink to="/" variant="secondary">
            <HyIcon name="shelves" size={18} /> Ir a la Biblioteca
          </ButtonLink>
        </div>
      ) : (
        <div className="hy-fade-in grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {favBuilds.map((b) => (
            <BuildCard key={b.id} build={b} catalog={catalog} />
          ))}
        </div>
      )}
    </div>
  );
}
