---
name: Voxelfold
description: Taller de construcción voxel preciso, oscuro y artesanal, con identidad propia.
mode: dark-first
tokens:
  colors:
    bg: "#0f1822"
    surface: "#16212d"
    surface-2: "#1b2836"
    elevated: "#26384a"
    line: "#3a4d62"
    ink: "#e9eff6"
    muted: "#9fb1c4"
    accent: "#5a7da8"
    accent-hi: "#82a6d4"
    accent-ink: "#0b1119"
    gold: "#e0a64b"
    danger: "#d4674e"
  typography:
    display: "'Lexend', 'Nunito Sans', system-ui, sans-serif"
    sans: "'Nunito Sans', system-ui, -apple-system, sans-serif"
    mono: "'Noto Mono', ui-monospace, monospace"
  rounded:
    control: "0.5rem"
    panel: "0.625rem"
    app-icon: "22%"
  spacing:
    unit: "0.25rem"
    compact: "0.5rem"
    panel: "1rem"
    section: "1.5rem"
  components:
    primary-action: "accent con texto accent-ink y estado hover accent-hi"
    panel: "surface o surface-2, borde line de 1 px y profundidad contenida"
    focus-ring: "accent-hi con un contorno mínimo de 2 px"
---

# DESIGN.md — Voxelfold

## Overview

Voxelfold es un taller profesional para entender, editar y ejecutar construcciones de Hytale. Su interfaz combina la precisión de un plano arquitectónico con materiales de fantasía voxel: piedra azul oscura, tinta clara, líneas técnicas y pequeños acentos de oro. Debe sentirse robusta y especializada, nunca como un panel web genérico.

Este documento tiene precedencia sobre recomendaciones visuales genéricas. Los tokens efectivos se mapean literalmente en `src/index.css`; cualquier cambio de identidad debe actualizar ambos archivos y volver a pasar el lint de `DESIGN.md`.

Los recursos de Hytale son contenido local aportado por el usuario. Voxelfold puede utilizarlos dentro de la aplicación mediante `voxelfold-asset://`, pero no los empaqueta, publica ni usa como identidad propia. El símbolo, los iconos de aplicación y el material público de GitHub son propiedad visual independiente de Voxelfold.

## Colors

La jerarquía de fondos es `bg` → `surface` → `surface-2` → `elevated`. `ink` expresa contenido principal y `muted` información secundaria. `accent` identifica acciones, selección y foco; `gold` queda reservado para hitos, dificultad y detalles de marca; `danger` comunica errores y acciones destructivas.

El contraste objetivo es WCAG AA. No se debe reducir la opacidad del texto por debajo de lo necesario para mantenerlo, ni usar `gold` como sustituto de `danger`.

## Typography

- Lexend se usa en marca, títulos de construcción y encabezados de alta jerarquía.
- Nunito Sans se usa en controles, navegación, texto y datos de interfaz.
- Noto Mono se reserva para coordenadas, métricas de render, identificadores y datos técnicos.
- Todo el texto visible se redacta en español Unicode completo, con una voz directa y útil para constructores.

Las fuentes empaquetadas tienen licencia SIL OFL y sus avisos se conservan en `public/fonts/LICENSES.md`.

## Layout

La aplicación prioriza el lienzo 3D. Las herramientas permanecen cerca del borde, los paneles laterales son redimensionables y la información contextual no debe tapar la construcción. La unidad de espaciado es 4 px; los controles compactos parten de 8 px y los paneles de 16 px.

La densidad puede ser alta, pero cada grupo funcional necesita separación visible. Los estados vacío, carga, error y sincronización conservan la misma estructura para evitar saltos.

## Elevation & Depth

Los paneles usan bordes de 1 px y sombras profundas pero contenidas. Popovers, menús y modales ascienden a `elevated`; el lienzo nunca recibe sombras DOM decorativas. El bisel se expresa con un borde superior ligeramente más claro, no con degradados brillantes.

Cuando la instalación local aporta nine-patches compatibles, las clases `.hy-panel`, `.hy-btn-*`, `.hy-header` y `.hy-tooltip` pueden utilizarlos. El fallback CSS propio debe conservar exactamente la misma geometría y accesibilidad.

## Shapes

Los controles tienen radio de 8 px y los paneles de 10 px. Las formas son sólidas, con esquinas trabajadas y sin exceso de cápsulas.

El símbolo de Voxelfold representa dos planos voxel plegados que forman una V isométrica, unidos por una clave dorada. Nunca debe recortarse, deformarse, recolorearse con una sola tinta ni combinarse con el cristal verde anterior. Mantener un área libre mínima del 12,5 % del ancho del símbolo.

## Components

- Botones: reutilizar `ui/Button` y `ui/ButtonLink`; la acción primaria usa el token `accent`.
- Tarjetas de construcción: reutilizar `BuildCard`, con miniatura, título, metadatos y progreso en jerarquía estable.
- Búsqueda, menús, modales, chips y estados: reutilizar los componentes existentes de `src/components/ui`.
- Foco: anillo `accent-hi` de al menos 2 px, visible en todos los fondos.
- Iconos funcionales: Lucide o iconos locales de Hytale cuando el concepto pertenece al juego; no usar emojis.
- Bloques y materiales: mostrar siempre el icono o textura oficial resuelta desde la instalación local, con un fallback explícito de error y nunca con una imitación inventada.
- Métricas 3D: Noto Mono, fondo `surface-2`, borde `line`; deben mantenerse legibles sin cubrir la escena.
- Marca: `public/brand/voxelfold-icon.png` es la fuente web y `src-tauri/icons` contiene sus derivados nativos.

## Do's and Don'ts

### Do

- Priorizar legibilidad, precisión espacial y respuesta inmediata.
- Conservar AO, bloom y animación con degradación adaptativa de resolución antes de eliminar efectos.
- Usar los assets de Hytale exclusivamente desde la instalación autorizada del usuario.
- Mantener el símbolo de Voxelfold reconocible a 16 px y sobre fondos oscuros.
- Redactar microcopy concreto: «Empieza esta construcción», «Reúne estos materiales», «Continúa donde lo dejaste».

### Don't

- No publicar texturas, prefabs, modelos, iconos ni archivos comprimidos procedentes del repositorio privado de Hytale.
- No usar el logotipo o la marca de Hytale como logotipo de Voxelfold.
- No introducir emojis, gradientes neón, glassmorphism excesivo ni componentes con estética ajena al taller voxel.
- No ocultar errores de resolución de recursos con texturas genéricas que puedan confundirse con el bloque real.
- No sacrificar accesibilidad o estabilidad del editor por ornamentación.
