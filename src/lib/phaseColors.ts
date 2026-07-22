/** Colores distintivos por fase (cimentación → remate). Se reciclan si hay más fases. */
export const PHASE_COLORS = [
  "#e0a64b", // dorado
  "#5fb0e8", // azul
  "#6fd089", // verde
  "#d77ad0", // magenta
  "#e87f5f", // naranja
  "#c9d05f", // lima
  "#7a8cf0", // índigo
  "#e85f8a", // rosa
];

export function phaseColor(phase: number): string {
  const n = PHASE_COLORS.length;
  return PHASE_COLORS[((phase % n) + n) % n];
}
