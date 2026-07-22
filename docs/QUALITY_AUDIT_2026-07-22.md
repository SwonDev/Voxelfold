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

## Revisión UI/UX del editor y superficies 3D

La revisión visual posterior detectó una regresión de jerarquía que no aparecía en la auditoría
estática inicial: el lienzo acumulaba el rail completo de once herramientas, coordenadas, vistas,
medidas, entorno, AO, diagnóstico y una ayuda de ratón permanente. Cada control era válido por
separado, pero juntos ocultaban la construcción y reducían el área útil.

### Hallazgos resueltos

- **Alta — Chrome 3D permanente:** editor y visor agrupaban cámara, entorno y calidad en filas
  siempre visibles. Se sustituyeron por un único popover «Vista», accesible con teclado y Escape.
- **Alta — Rail sobredimensionado:** once botones y sus atajos ocupaban casi toda la altura. El rail
  mantiene las herramientas 1–5 en orden y abre formas/selección bajo demanda, sin perder atajos.
- **Alta — Operaciones masivas:** una caja de 161 × 161 × 64 podía generar más de 1,6 millones de
  celdas en el hilo de interfaz. La previsualización se limita y las operaciones de más de 100.000
  celdas se rechazan con una explicación recuperable.
- **Media — Diagnóstico persistente:** una prueba dejaba el HUD de FPS activo mediante
  `localStorage`. Ahora es efímero, empieza apagado y no contamina futuras sesiones.
- **Media — Brocha par:** un diámetro 2 o 4 producía una brocha menor. Los diámetros pares se
  normalizan al siguiente impar y la interfaz lo comunica.
- **Media — Revolve ×2:** la segunda copia quedaba a 90°; ahora las dos copias se enfrentan a 180°.
- **Media — Flujo de opciones:** al elegir línea, caja, relleno, brocha, selección o pegado, el panel
  lateral abre automáticamente «Escena» para mostrar sus parámetros.
- **Media — Ventanas estrechas:** cabeceras y márgenes se adaptan por estructura; editor y guía
  compactan la navegación global al entrar y permiten expandirla de nuevo con Ctrl/⌘+B.

### Validación nativa posterior

- Aplicación Tauri 0.2.0 compilada con firma Apple Development, instalada en
  `/Applications/Voxelfold.app` y probada como aplicación macOS, no en navegador.
- Construcción real de 2.789 bloques: 60 FPS, 238 draw calls, DPR 1,5 y horneado de 31 ms fuera del
  hilo durante la muestra nativa, con AO, bloom, sombras y animación activos.
- Verificados visualmente Biblioteca, detalle/visor, Editor 3D, Bloques, Comunidad, Importar y
  Ajustes; sin solapes en el ancho mínimo de ventana ni pérdida de foco al cerrar popovers.
- La suite frontend pasó de 17 a 25 pruebas e incorpora geometría de línea/caja/relleno/brocha y
  transformaciones de selección, rotación, espejo, revolve y stack.

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
