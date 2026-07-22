import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Build, type BuildMetaUpdate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/Modal";
import { BuildMetaFields } from "@/components/BuildMetaForm";
import { errorMessage } from "@/lib/errorMessage";

export function EditBuildDialog({ build, onClose }: { build: Build; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<BuildMetaUpdate>({
    name: build.name,
    description: build.description,
    category: build.category,
    style: build.style,
    difficulty: build.difficulty,
    mode: build.mode,
    estimated_time_min: build.estimated_time_min,
  });

  const save = useMutation({
    mutationFn: () => api.updateBuildMeta(build.id, f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["build", build.id] });
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
      onClose();
    },
  });

  return (
    <Modal onClose={onClose} label="Editar build">
      <h3 className="mb-4 text-xl">Editar build</h3>
      <BuildMetaFields value={f} onChange={setF} />
      {save.error && <p className="mt-3 text-sm text-danger">{errorMessage(save.error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !f.name.trim()}>
          {save.isPending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </Modal>
  );
}
