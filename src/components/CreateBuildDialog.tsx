import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type BuildMetaUpdate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/Modal";
import { BuildMetaFields, emptyMeta } from "@/components/BuildMetaForm";
import { errorMessage } from "@/lib/errorMessage";

export function CreateBuildDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Nombre por defecto: el editor arranca al instante (sin fricción), renombrable luego.
  const [f, setF] = useState<BuildMetaUpdate>({ ...emptyMeta, name: "Prefab nuevo" });

  const create = useMutation({
    mutationFn: (toEditor: boolean) => api.createBuild(f).then((id) => ({ id, toEditor })),
    onSuccess: ({ id, toEditor }) => {
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
      onClose();
      navigate(toEditor ? `/build/${id}/editor` : `/build/${id}`);
    },
  });

  return (
    <Modal onClose={onClose} label="Nueva build">
      <h3 className="mb-1 text-xl">Nuevo prefab / build desde cero</h3>
      <p className="mb-4 text-sm text-muted">
        Crea una construcción propia. Ábrela en el <span className="text-ink">Editor 3D</span> para
        construirla con bloques nativos de Hytale, o como guía para añadir fases y pasos en la ficha.
      </p>
      <BuildMetaFields value={f} onChange={setF} />
      {create.error && <p className="mt-3 text-sm text-danger">{errorMessage(create.error)}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="secondary"
          onClick={() => create.mutate(false)}
          disabled={create.isPending || !f.name.trim()}
        >
          {create.isPending ? "Creando…" : "Crear como guía"}
        </Button>
        <Button onClick={() => create.mutate(true)} disabled={create.isPending || !f.name.trim()}>
          {create.isPending ? "Creando…" : "Crear y construir en 3D"}
        </Button>
      </div>
    </Modal>
  );
}
