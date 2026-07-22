// Sistema de notificaciones efímeras (toasts) sin librerías: pub/sub a nivel de módulo.
export type ToastKind = "info" | "success" | "error";
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

export function toastDuration(kind: ToastKind): number {
  return kind === "error" ? 7_000 : 3_500;
}

let listeners: ((t: Toast[]) => void)[] = [];
let toasts: Toast[] = [];
let nextId = 1;

function emit() {
  for (const l of listeners) l(toasts);
}

/** Muestra un toast y deja más tiempo de lectura a los errores. Devuelve su id. */
export function toast(message: string, kind: ToastKind = "info"): number {
  const id = nextId++;
  toasts = [...toasts, { id, message, kind }];
  emit();
  setTimeout(() => dismiss(id), toastDuration(kind));
  return id;
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(l: (t: Toast[]) => void): () => void {
  listeners.push(l);
  l(toasts);
  return () => {
    listeners = listeners.filter((x) => x !== l);
  };
}
