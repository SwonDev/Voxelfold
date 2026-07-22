# Roadmap de Voxelfold

> Mapea el estado actual de la app contra el roadmap conceptual del briefing
> (§21) y detalla la **Fase 2 y siguientes** como trabajo de ingeniería accionable.
> Última actualización: 2026-07-22.

Voxelfold es una **app de segunda pantalla** (companion) de guías de construcción
para Hytale. El usuario elige una build y la monta él mismo, fase a fase, con
materiales, previews y progreso. No pega prefabs terminados. Modelo de assets
**BYO** (bring-your-own): se lee la instalación local de Hytale, nunca se
redistribuye nada (EULA + briefing §17).

---

## Fase 1 — Companion de guías · **MVP COMPLETADO** ✅

Objetivo del briefing: experiencia básica para construir con Voxelfold como
segunda pantalla. Estado actual:

| Capacidad | Estado | Notas |
|---|---|---|
| Detección/selección de Hytale local | ✅ | `locator` multiplataforma + selección manual + reintento |
| Lectura de `Assets.zip` sin extraer (3,2 GB) | ✅ | `AssetReader` por entrada con `zip` crate |
| Catálogo **completo** de bloques (todos, no una muestra) | ✅ | `BlockBrowser` con carga incremental sin tope; ~2939 colocables + items |
| Bloques **categorizados** (Bloques/Mobiliario/Objetos…) | ✅ | derivado de `Categories`; filtros de categoría/subcategoría en lista y editor |
| Selector de **cualquier bloque** en el editor 3D | ✅ | modal `BlockBrowser` (buscar/filtrar todo el catálogo) |
| Autoactualización al actualizarse Hytale | ✅ | detecta cambios del `Assets.zip` (mtime) y recarga assets+catálogo |
| Diagnóstico de compatibilidad del `Assets.zip` | ✅ | métricas y errores visibles en Ajustes + `cargo run --example asset_audit` |
| Autodetección robusta de Hytale | ✅ | escanea canales/versiones + bases por SO; onboarding autodetecta al abrir |
| Catálogo de bloques con iconos/texturas/nombres reales | ✅ | `catalog` + `lang` (traducciones reales) |
| Importación de prefabs reales (formato v8) | ✅ | `prefab` + `curation` (fases por altura Y) |
| **Colección curada** (25 builds reales) | ✅ | `core::seed` resuelve por fragmento de ruta; robusto entre versiones |
| Biblioteca: búsqueda, filtros, estado, favoritos, “continúa” | ✅ | `routes/Library` |
| Ficha de build: fases, pasos, materiales totales | ✅ | `routes/BuildDetail` |
| Guía paso a paso: checklist, materiales por fase, progreso, reset | ✅ | `routes/Guide` |
| Visor 3D voxel con texturas reales, fases, ghost blocks | ✅ | `VoxelViewer` (R3F + InstancedMesh) |
| **Miniatura real** capturada del visor | ✅ | `set_thumbnail` (canvas → data URL) |
| Curación interna: editar metadatos, fases y pasos | ✅ | `EditBuildDialog` + `EditPhasesDialog` |
| **UI 100% nativa de Hytale** (paneles, botones, slots, cabeceras, tooltips, fuente) | ✅ | assets reales vía protocolo `voxelfold-asset://` |
| Branding propio (planos voxel plegados + clave dorada) | ✅ | identidad y derivados nativos documentados en `docs/BRAND.md` |
| Persistencia (SQLite) + tests del Core | ✅ | `rusqlite` + `rusqlite_migration`; 19+ tests verdes |

**Pendientes menores de Fase 1 (pulido, no bloqueantes):**

- [x] Onboarding con autodetección al abrir.
- [x] Exportar la lista de materiales (copiar/clipboard).
- [x] Accesibilidad: diálogos con `role`/`aria-modal` + cerrar con Escape; botones con `aria-label`.
- [x] Ajustes: idioma del catálogo y recarga segura de la biblioteca.
- [x] Persistir la cámara/encuadre preferido del visor por build y ofrecer vistas rápidas
      isométrica, cenital, frontal y lateral.

**Calidad de los prefabs importados:**

- [x] Descartar terreno/relleno (suelo, hierba, arena, escombros) → se ve la construcción, no el pad.
- [x] Sonidos reales de Hytale al colocar/romper en el editor.
- [x] Caché offline de las búsquedas de la comunidad.

**Render 3D fiel:**

- [x] **Modelos 3D reales** (`.blockymodel`) para muebles, plantas y props (cajas + quads con
      UV del atlas), en editor y guía; toggle + caída a cubo si falla. La escala nativa
      `CustomModelScale` se respeta desde el pre-release de 2026-07-17.
- [x] **Plano de construcción por capas sincronizado** con el visor: cotas exteriores, filtro
      por material, modos montaje/hasta capa/solo capa y huellas multicelda calculadas desde los
      hitboxes oficiales. Distingue anclas colocables, celdas filler y solapamientos.
- [x] `RotationTuple` completo (64 combinaciones yaw/pitch/roll) en render, orientación
      automática y transformaciones de selección.
- [ ] Texturas por cara (top/lado/abajo) en los cubos.
- [ ] Variantes de modelo por estado/rotación del bloque.

---

## Fase 2 — Herramientas para creadores (editor público) · **COMPLETADA** ✅

Objetivo: que un builder cree y publique sus propias guías **dentro de la app**,
sin depender de importar un prefab.

### 2.1 Crear build desde cero ✅
- Comando `create_build` (slug único garantizado) + `CreateBuildDialog`.
- Botón «Nueva build» en la biblioteca; formulario compartido `BuildMetaForm`.

### 2.2 Editor de fases y pasos (CRUD completo) ✅
- `repo`: `delete_phase`, `delete_step`, `reorder_phases`, `reorder_steps` (+ los previos `update_*`/`add_*`).
- `EditPhasesDialog` reescrito: añadir/eliminar/reordenar (▲▼) fases y pasos, textos editables.
- Borrar build con confirmación (`delete_build`).
- [ ] Pendiente menor: drag & drop (hoy reorden con botones ▲▼).

### 2.3 Materiales manuales por fase ✅
- `set_phase_materials` + `recompute_build_materials` (suma fases → total + `block_count`).
- `EditMaterialsDialog`: buscador del catálogo real de Hytale para elegir bloques y cantidades.

### 2.4 Capturas/preview por paso
- [ ] Reutilizar la captura del visor (`set_thumbnail`) para guardar un `preview_ref` por paso.
- [ ] Permitir adjuntar imágenes propias del builder (copiar a `app_data/previews/`).

### 2.5 Editor visual de voxels (constructor in-app) ✅
- `VoxelEditor` (react-three-fiber): clic coloca (suelo o cara apuntada vía normal), Mayús+clic borra.
- Coloreado por fase + «atenuar otras» para construir con foco; texturas reales; grid + gizmo de ejes.
- Selector de bloque (buscador del catálogo real) y de fase (con «+ Fase»).
- Backend `curation::set_voxel_model` (+ comando `set_build_voxels`): guarda el modelo, crea las fases
  necesarias y recalcula materiales por fase y total. Ruta `/build/:id/editor`, botón «Editor 3D».
- [x] Rotación oficial completa: `R` gira yaw, `⇧R` inclina pitch y `⌥R` modifica roll;
      se conserva en editor, guía, copias, espejos y arrays.
- [x] Previsualización «fantasma» al apuntar (verde colocar / rojo borrar).
- [x] Deshacer/rehacer (Ctrl+Z / Ctrl+Shift+Z) y vaciar.

### 2.6 Exportar/importar guías (intercambio entre usuarios, aún local) ✅
- Formato `.voxelfold` (`core::portable`): meta + fases + pasos + materiales + modelo voxel, **sin** assets.
- Comandos `export_build`/`import_build` (E/S en Rust, ruta por diálogo Tauri); validación de formato/versión.
- Botón «Exportar» en la ficha e «Importar» en la biblioteca.

> **Estado:** 2.1, 2.2, 2.3, 2.5 y 2.6 hechos y testeados. La autoría de guías es
> completamente funcional de principio a fin (textual **y visual**). Solo queda 2.4
> (preview por paso) como pulido menor.

---

## Fase 3 — Importación y apoyo con prefabs · **iniciada** 🟢

Objetivo: usar prefabs como **ayuda** para crear guías, no como sustituto.
Parte ya está hecha en el MVP (se importan prefabs reales). Ampliaciones:

- [x] Importar un `.prefab.json` suelto del disco (`import_prefab_file` + botón en biblioteca).
- [x] Cargar prefabs/guías **de la comunidad** localmente: `.prefab.json` (Hytale) y `.voxelfold` (guías compartidas).
- [x] **Buscar prefabs públicos de la comunidad** dentro de la app (página «Comunidad»): consulta
      repositorios públicos de GitHub (API pública, sin servidor propio), lista sus `.prefab.json`,
      los descarga e importa **acreditando al autor** (owner, licencia y URL de origen). La ficha
      muestra el crédito con enlaces al perfil y a la fuente.
- [x] Abrir cualquier repo público por **URL** (`fetch_community_repo`) + **filtro** de prefabs.
- [x] Importar prefabs del usuario por **carpeta (lote)** desde mundos/builds propias (`import_prefab_folder`).
- [ ] Más fuentes públicas de prefabs (otros hubs comunitarios con listados accesibles).
- [x] CurseForge: búsqueda/descarga por API con clave propia protegida por el llavero del sistema.
- [x] División automática en fases sobre **niveles Y poblados** (evita fases vacías por huecos).
- [x] División por **componentes**: separa el detalle/remate (mobiliario, decoración, plantas,
      luces — según categoría del catálogo) a la última fase; la estructura se reparte por altura.
- [ ] Detección de “bloques de detalle” para sugerir un paso de remate final.
- [ ] Editar la curación generada antes de guardar (previsualizar fases sugeridas).
- [ ] Cálculo de materiales por sustitución (si falta un bloque, sugerir equivalente del catálogo).
- [ ] Importar `.litematic` y `.schem` como **borradores de guía**, con tabla editable de
      equivalencias Minecraft → Hytale, vista previa y registro explícito de sustituciones.
- [ ] Importación/edición directa de `.blockymodel` apoyada en el codec del plugin oficial de
      Blockbench, sin duplicar ni redistribuir texturas del juego.

---

## Fase 4 — Integración in-game

Objetivo: llevar opcionalmente la sesión de Voxelfold dentro de Hytale con un plugin Java de
servidor. La API ya existe; el trabajo pendiente es diseñar un protocolo local estable y respetar
que las páginas/HUD de Custom UI son dirigidas por el servidor y no permiten modificar libremente
la UI cliente.

- [ ] Plugin companion mínimo: emparejamiento local, selección de construcción/fase y estado de
      conexión, sin abrir el servidor a la red por defecto.
- [ ] Holograma/ghost preview de la capa actual con rotación, posicionamiento libre, filtro de
      material y alternativa visual para quien no instale recursos cliente.
- [ ] Validación incremental de bloques colocados: correcto, faltante, incorrecto y omitido;
      progreso persistente por sitio de construcción y reconexión.
- [ ] Materiales requeridos/restantes, detección del bloque sostenido y sustituciones explícitas.
- [ ] Varios sitios simultáneos, estadísticas y construcción colaborativa con permisos por jugador.
- [ ] Secuencias de cámara del servidor para recorridos y comparación antes/después cuando la API
      sea estable en la versión instalada.

> **Riesgo:** las APIs pre-release siguen cambiando (`PlaceBlockInteraction`, Custom UI,
> multicelda). El companion continuará siendo plenamente útil sin instalar el plugin.

### Referencias técnicas y benchmark comunitario

- [Plugin oficial Hytale para Blockbench](https://github.com/JannisX11/hytale-blockbench-plugin):
  codecs `.blockymodel`/`.blockyanim` y flujo oficial de modelado.
- [Hytale Blockbench Bridge](https://github.com/tazercopter/Hytale-Blockbench-Bridge): patrón de
  puente servidor ↔ Blockbench para editar assets locales/remotos.
- [PrefabBuilder](https://www.curseforge.com/hytale/mods/prefabbuilder): benchmark de hologramas,
  capas, materiales, validación, sitios persistentes y colaboración.
- [SchematicImporter](https://www.curseforge.com/hytale/mods/schematicimporter): benchmark para
  mapeo editable y paginado de bloques `.litematic`/`.schem`.
- [Documentación comunitaria de Custom UI](https://github.com/HytaleModding/site/blob/main/content/docs/en/official-documentation/custom-ui/index.mdx)
  y [notas oficiales del Update 6](https://hytale.com/news/2026/5/pre-release-patch-notes-update-6).

---

## Fase 5 — Comunidad (SIN nube propia)

> **Decisión del usuario:** la app es **100% local; no habrá servidor/nube propios.**
> El descubrimiento de contenido de la comunidad se hace consultando **fuentes
> públicas existentes** (hoy GitHub), no una plataforma nuestra. La atribución al
> autor es obligatoria. Esto **ya funciona** (página «Comunidad», Fase 3).

Ampliaciones posibles, siempre locales y sobre fuentes públicas de terceros:

- [ ] Integrar más hubs públicos de prefabs (los que ofrezcan listados/descarga accesibles).
- [ ] Caché local de resultados de búsqueda para uso sin conexión.
- [ ] Filtros (tamaño, etiquetas, bioma) sobre los resultados públicos.
- [ ] Compartir hacia fuera: exportar `.voxelfold`/`.prefab.json` para subir a esos hubs (manual).

> Lo que NO se hará: cuentas propias, almacenamiento en la nube, rankings/monetización
> centralizados. El intercambio se apoya en archivos y en las plataformas públicas que
> la comunidad ya usa.

---

## Principios que NO cambian (briefing §22–24)

- Nunca “pulsa un botón y aparece la build”: siempre construcción manual guiada.
- No redistribuir assets de Hytale: modelo BYO, lectura local.
- No copiar la identidad **oficial** de Hytale (branding propio), pero sí usar sus
  assets de UI en local para que el companion se sienta nativo.
- El usuario debe poder responder en todo momento: qué construyo, cómo quedará, qué
  materiales necesito (ahora y en total), qué paso toca y cuánto queda.
