import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Pila de modales activos: solo el superior captura Tab/Escape (soporta anidamiento).
const stack: symbol[] = [];

/**
 * Atrapa el foco dentro de `ref` mientras `active` (modales): foco inicial en el primer
 * elemento, ciclo con Tab/Shift+Tab, Escape llama `onEscape`, y restaura el foco previo al
 * cerrar. Con modales anidados, solo el más reciente responde. El contenedor debe tener
 * `tabIndex={-1}`.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active = true,
  onEscape?: () => void,
) {
  const escRef = useRef(onEscape);
  escRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const token = Symbol("modal");
    stack.push(token);
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
    (focusables()[0] ?? node).focus();

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token) return; // no soy el modal superior
      if (e.key === "Escape") {
        e.stopPropagation();
        escRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      const at = document.activeElement;
      if (!node.contains(at)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && at === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.indexOf(token);
      if (i >= 0) stack.splice(i, 1);
      prev?.focus?.();
    };
  }, [ref, active]);
}
