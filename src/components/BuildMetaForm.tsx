import type { BuildMetaUpdate } from "@/lib/api";
import { inputCls } from "@/components/ui/inputStyles";

export { inputCls };

/** Metadatos por defecto para una build nueva. */
export const emptyMeta: BuildMetaUpdate = {
  name: "",
  description: "",
  category: "",
  style: "",
  difficulty: "Fácil",
  mode: "both",
  estimated_time_min: 30,
};

/** Campos de metadatos de una build, controlados. Compartido por crear y editar. */
export function BuildMetaFields({
  value,
  onChange,
}: {
  value: BuildMetaUpdate;
  onChange: (v: BuildMetaUpdate) => void;
}) {
  const set = (k: keyof BuildMetaUpdate, v: string | number) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-muted">Nombre</span>
        <input
          className={inputCls}
          value={value.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="p. ej. Cabaña del bosque"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted">Descripción</span>
        <textarea
          className={inputCls}
          rows={3}
          value={value.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="¿Qué es esta build y para qué sirve?"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Categoría</span>
          <input
            className={inputCls}
            value={value.category}
            onChange={(e) => set("category", e.target.value)}
            placeholder="Vivienda, Torre…"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Estilo</span>
          <input
            className={inputCls}
            value={value.style}
            onChange={(e) => set("style", e.target.value)}
            placeholder="Rústico, Marino…"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Dificultad</span>
          <select
            className={inputCls}
            value={value.difficulty}
            onChange={(e) => set("difficulty", e.target.value)}
          >
            <option value="Fácil">Fácil</option>
            <option value="Media">Media</option>
            <option value="Difícil">Difícil</option>
            <option value="Experto">Experto</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Tiempo (min)</span>
          <input
            type="number"
            min={0}
            className={inputCls}
            value={value.estimated_time_min}
            onChange={(e) => set("estimated_time_min", Number(e.target.value))}
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs text-muted">Modo</span>
        <select
          className={inputCls}
          value={value.mode}
          onChange={(e) => set("mode", e.target.value)}
        >
          <option value="both">Survival y Creative</option>
          <option value="survival">Survival</option>
          <option value="creative">Creative</option>
        </select>
      </label>
    </div>
  );
}
