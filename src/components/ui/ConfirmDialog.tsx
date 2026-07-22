import type { ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";

/**
 * Diálogo de confirmación reutilizable con estética NATIVA de Hytale: panel nine-patch real
 * (vía {@link Modal}/`.hy-panel`) + botones con la piel del juego (`.hy-btn-*`). Para acciones
 * destructivas (`destructive`) el botón principal usa la piel `destructive`.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = false,
  closeAfterConfirm = true,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  closeAfterConfirm?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} label={title} role="alertdialog" maxW="max-w-sm">
      <h3 className="mb-2 pr-6 text-xl">{title}</h3>
      <p className="mb-5 text-sm text-muted">{message}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          size="sm"
          onClick={() => {
            onConfirm();
            if (closeAfterConfirm) onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
