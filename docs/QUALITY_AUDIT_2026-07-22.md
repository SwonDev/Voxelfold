# Auditoría de calidad — 22 de julio de 2026

## Veredicto de anti-patrones

**Aprobado.** La aplicación no parece una interfaz genérica generada por IA: mantiene una dirección
visual propia y consistente de “taller Hytale”, usa tipografías y nine-patch definidos en
`DESIGN.md`, evita gradientes decorativos de moda, tarjetas anidadas sin propósito y copy
redundante. Los recursos del juego se cargan desde la instalación local y no se sustituyen por
placeholders artificiales.

## Resumen ejecutivo

- Críticos: **0**
- Altos: **1**, externo a la aplicación
- Medios: **3**
- Bajos: **1**
- Puntuación antes del hardening: **94/100**
- Puertas ya superadas: TypeScript, Vite, Rust tests, Clippy sin avisos, CSP, permisos mínimos de
  Tauri, `npm audit` sin vulnerabilidades y `DESIGN.md` sin hallazgos.

## Hallazgos

### Alta — El canal público de releases aún no existe

- **Ubicación:** endpoint de `src-tauri/tauri.conf.json` y distribución externa.
- **Categoría:** Resiliencia / distribución.
- **Impacto:** la búsqueda manual devuelve un fallo de red y la actualización automática no puede
  entregar versiones. Además, el equipo solo dispone de una identidad Apple Development; una
  descarga pública necesita Developer ID Application y notarización para pasar Gatekeeper.
- **Recomendación:** crear `SwonDev/Voxelfold`, cargar los secretos de CI descritos en
  `docs/RELEASING.md` y publicar el primer borrador notarizado tras revisarlo.
- **Estado:** bloqueado hasta confirmación explícita de publicación y disponibilidad del certificado.

### Media — Regiones vivas anidadas en las notificaciones

- **Ubicación:** `src/components/ui/Toaster.tsx`.
- **Categoría:** Accesibilidad.
- **Impacto:** VoiceOver puede anunciar dos veces el mismo mensaje porque el contenedor y cada
  notificación declaran `status`/`alert` simultáneamente.
- **Estándar:** WCAG 4.1.3 (mensajes de estado).
- **Recomendación:** mantener el rol solo en cada notificación y dejar el contenedor neutro.
- **Estado posterior:** resuelto; cada mensaje conserva una única región viva y los errores disponen
  de siete segundos de lectura.

### Media — Persistencia del sondeo asume `localStorage` operativo

- **Ubicación:** `src/components/AppUpdater.tsx`.
- **Categoría:** Resiliencia.
- **Impacto:** un almacenamiento deshabilitado o corrupto podría abortar el sondeo diario aunque la
  actualización por red siga siendo posible.
- **Recomendación:** encapsular lectura/escritura en funciones tolerantes a errores.
- **Estado posterior:** resuelto; el sondeo continúa aunque el almacenamiento local falle.

### Media — El editor podía perder cambios al navegar o actualizar

- **Ubicación:** `src/routes/Editor.tsx`, `src/App.tsx` y `src/components/AppUpdater.tsx`.
- **Categoría:** Integridad de datos / calidad de vida.
- **Impacto:** un enlace, Atrás/Adelante, cierre de ventana, actualización de Voxelfold o recarga del
  catálogo de Hytale podía desmontar un documento modificado antes de guardarlo.
- **Recomendación:** mantener una instantánea exacta del último guardado y coordinar todos los
  consumidores que puedan desmontar el editor.
- **Estado posterior:** resuelto; navegación SPA y cierre están protegidos, `⌘/Ctrl+S` guarda, el
  estado visual distingue guardado/sucio y las actualizaciones se aplazan hasta un punto seguro.
- **Validación:** probados enlace lateral, botón Atrás, cancelar, descartar y guardar con teclado en
  navegador real; 17 pruebas frontend cubren también comparación exacta y ciclo de sesión.

### Baja — Chunk 3D pesado, aunque totalmente diferido

- **Ubicación:** chunk compartido por `VoxelViewer` y `VoxelEditor` (Three.js / R3F).
- **Categoría:** Rendimiento.
- **Impacto:** primera apertura del visor descarga aproximadamente 350 KiB gzip adicionales; no
  afecta a la carga inicial de Biblioteca/Ajustes.
- **Recomendación:** conservar el lazy-loading actual y vigilar regresiones. Fraccionarlo más no
  reduce el coste total del primer visor y añadiría latencia/cascadas.

## Patrones sistémicos

- Los colores hexadecimales fuera de `index.css` pertenecen a iluminación, selección y materiales de
  la escena 3D; no son desviaciones de los tokens de chrome.
- Los `unwrap` detectados están en tests/fixtures; el camino de producción propaga errores.
- Las llamadas remotas pasan por Rust, validan HTTPS y dominio, y el webview mantiene una CSP cerrada.

## Aspectos positivos

- Navegación, botones, formularios, modales y búsquedas exponen semántica accesible.
- Trampa de foco, Escape, restauración de foco y preferencias de movimiento reducido implementadas.
- Estados vacíos, carga, error y recuperación presentes en las rutas principales.
- Minificación 3D diferida: el chunk grande no se importa hasta abrir visor/editor.
- Actualizaciones firmadas, con permiso Tauri mínimo y confirmación humana antes de reiniciar.

## Prioridad de corrección

1. Mantener cubiertas por regresión las tres incidencias medias ya corregidas.
2. Mantener el bundle 3D diferido y controlado por límite explícito.
3. En el último punto seguro, solicitar autorización para crear/publicar el canal GitHub y configurar
   la identidad Developer ID cuando esté disponible.
