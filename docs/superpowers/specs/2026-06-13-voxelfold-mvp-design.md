# Voxelfold — Documento de diseño (MVP)

- **Versión:** 1.0
- **Fecha:** 2026-06-13
- **Producto:** Voxelfold — *Build Guides for Hytale* (guías de construcción para Hytale)
- **Briefing fuente:** `voxelfold-briefing-desarrollo.md` (v0.2)
- **Estado:** Diseño aprobado en brainstorming, pendiente de revisión final del usuario antes del plan de implementación.

---

## 1. Resumen ejecutivo

Voxelfold es una **aplicación de escritorio nativa, multiplataforma** (Tauri + Rust + SQLite, frontend React) que actúa como **compañero de construcción** para jugadores de Hytale: muestra builds curadas y guía al usuario para construirlas **a mano, paso a paso**, con materiales, fases, progreso y un **visor 3D voxel** que usa los **assets visuales reales de Hytale**.

La clave del producto no es pegar un prefab terminado, sino **enseñar a construir**. La clave técnica diferenciadora es que las visuales son **nativas reales** del juego, obtenidas **leyendo la instalación local del usuario** (modelo *bring-your-own assets*), sin redistribuir nunca artwork propietario.

## 2. Contexto verificado (investigación, junio 2026)

> Toda esta sección se verificó con fuentes web el 2026-06-13 (ver §16). No se asume nada de memoria.

### 2.1 Estado de Hytale
Hytale fue cancelado por Riot Games (23/06/2025), pero **Simon Collins-Laflamme recompró la IP** (17/11/2025), reformó Hypixel Studios como estudio independiente y **lanzó Hytale en Early Access el 13/01/2026** (solo Windows PC). A fecha de hoy va por el **Update 5 (26/05/2026)**, con servidores comunitarios, soporte de mandos, modding activo y base de jugadores real. **El proyecto Voxelfold tiene sentido pleno hoy.**

### 2.2 Formatos reales del juego (data-driven)
Hytale es **data-driven** (JSON + PNG), lo que hace viable la fidelidad sin "mocks":

- **`prefab.json`** — describe una estructura con: `Type`, `Id`, `Size [ancho, alto, profundo]`, `Origin`, **`Palette`** (mapeo carácter→bloque, p. ej. `W: hytale:oak_planks`, `S: hytale:stone`) y la matriz de bloques. De aquí salen **directamente** la lista de materiales (conteo por block ID) y los datos voxel para el visor 3D. Puede incluir bloques, entidades, NPCs y puntos de interacción (en el MVP solo nos interesan los bloques).
- **Assets del juego / asset pack** — estructura con `manifest.json` + `Common/` (`BlockTextures/*.png`, `Icons/ItemsGenerated/*.png`, `Models/`, `Animations/`) + `Server/Item/Items/*.json` (definiciones de bloques). De aquí sale el **catálogo de bloques real** (id → nombre, icono, textura, propiedades).
- Los assets base viven comprimidos en la instalación local (`Assets.zip`); los packs de usuario en `UserData/Packs/...`.

> **Riesgo conocido:** al ser Early Access, las rutas y esquemas exactos pueden variar entre updates. Por eso el proyecto **arranca con un spike** que inspecciona la instalación real (§13).

### 2.3 Marco legal
La **EULA de Hytale** establece que Hypixel Studios es propietario de todo el artwork. La *Creator Policy* solo licencia el **nombre** "Hytale" (uso descriptivo) y ciertos brand assets aprobados. **Empaquetar y redistribuir texturas oficiales infringiría la EULA** y contradiría la sección 17 del briefing. → La solución *bring-your-own* (leer assets en la máquina del usuario, sin redistribuir) es legal y se alinea con el briefing.

Disclaimer obligatorio en la app (briefing §17):
> *Voxelfold is an unofficial fan-made tool for Hytale builders. It is not affiliated with, endorsed by, or connected to Hypixel Studios. Hytale and related trademarks belong to Hypixel Studios.*

## 3. Decisiones tomadas (brainstorming)

| # | Decisión | Elección |
|---|---|---|
| D1 | Origen de assets visuales | **Bring-your-own**: leer instalación local de Hytale; nunca redistribuir |
| D2 | Visor de builds en el MVP | **Visor 3D voxel por fases** (no solo imágenes) |
| D3 | Plataformas | **Multiplataforma**, validando **primero en macOS** (el usuario tiene Hytale en Mac) y luego portando a Windows/Linux |
| D4 | Stack frontend + motor | **React + TypeScript + Vite + Tailwind + shadcn/ui + react-three-fiber (Three.js)** |
| D5 | Backend | **Rust** (Tauri core) + **SQLite** |
| D6 | Contenido inicial | **Mixto curado**: builds estrella propias + comunidad con permiso/atribución |
| D7 | Asignación bloques→fases | **Híbrido**: auto-sugerencia por capas/altura + ajuste manual del curador |
| D8 | Herramienta de curación | **Modo curación interno** dentro de la app (tras flag), reutilizando el Core; no es el editor público (Fase 2) |
| D9 | Arranque | **Spike primero** contra la instalación real de Hytale en Mac |
| D10 | Estética de la UI | **Doble capa**: (a) **iconos de bloques/items reales** (BYO local) en toda la interfaz; (b) **tema propio "Hytale-like"** para el chrome (paneles, botones, marcos, tipografía) con identidad propia, sin clonar ni redistribuir el HUD/fuentes propietarios de Hytale |

## 4. Principios de diseño

1. **Nativo real, nunca mock.** Texturas, iconos, nombres y datos de bloques se obtienen de Hytale real. Cuando el formato no esté confirmado, se lee del archivo real (no se inventa).
2. **No redistribuir artwork.** El repo, el código y los instaladores van limpios de assets de Hytale. La app los lee de la máquina del usuario en tiempo de ejecución.
3. **La guía es el núcleo, no el prefab.** El prefab es materia prima interna para generar materiales y datos voxel; el producto entrega una guía humana por fases.
4. **El Core hace el trabajo pesado; el frontend muestra.** Localizar, descomprimir, parsear, contar y persistir → Rust. Render e interacción → React/R3F.
5. **Unidades pequeñas y testeables.** Cada subsistema del Core tiene una responsabilidad única y una interfaz clara.
6. **Multiplataforma desde el diseño, validación incremental por OS.**

## 5. Arquitectura de alto nivel

```
Tauri Shell (ventana nativa multiplataforma)
├─ Frontend (WebView): React + TS + Vite + Tailwind + shadcn/ui + react-three-fiber + Zustand + TanStack Query
│     ▲  comandos IPC (tipados)         ▲  texturas vía custom protocol  voxelfold-asset://
│     │                                 │
└─ Core (Rust)
      ├─ Hytale Locator     (detección de instalación + selección manual)
      ├─ Asset Reader       (descomprime Assets.zip, cachea PNG, construye catálogo de bloques)
      ├─ Prefab Parser      (prefab.json → VoxelModel propio)
      ├─ Materials Calc     (conteo total y por fase usando el catálogo)
      ├─ Repos SQLite       (builds, fases, pasos, progreso, favoritos, checklist)
      └─ Tauri Commands     (API que consume el frontend)
            │
            ├─ SQLite (rusqlite o sqlx) — metadatos, guías, progreso
            └─ Caché en disco (app data) — PNG extraídos + VoxelModels por build

   (solo lectura) → Instalación local de Hytale: Assets.zip / Packs / prefabs
```

Las texturas PNG se sirven al WebView mediante un **custom protocol de Tauri** (`voxelfold-asset://<hash>`) en vez de pasar binarios por IPC, para rendimiento.

## 6. Subsistemas del Core (Rust)

### 6.1 Hytale Locator
- Detecta la instalación según OS (rutas candidatas para Windows/macOS/Linux; en macOS contemplar capa de compatibilidad/bottle si aplica).
- **Fallback manual**: el usuario selecciona la carpeta de instalación (robusto ante rutas no estándar).
- Persiste la ruta validada en SQLite (settings).
- Interfaz: `locate() -> Option<HytaleInstall>`, `set_manual_path(path) -> Result<HytaleInstall>`, `validate(path) -> Result<HytaleInstall>`.

### 6.2 Asset Reader
> El `Assets.zip` real pesa **3,2 GB con 60.148 entradas** → **lectura por entrada bajo demanda** (crate `zip`), nunca extracción total.
- Abre `Assets.zip` en **solo lectura** y lee entradas individuales por ruta.
- Cachea en disco **bajo demanda** las texturas (`Common/BlockTextures/*.png`) e iconos (`Common/Icons/ItemsGenerated/*.png`) que se vayan necesitando.
- Construye el **catálogo de bloques** recorriendo `Server/Item/Items/**/*.json`: por bloque lee `Icon`, `BlockType.Textures[]` (caras `All`/`Top`/`Side`... con `Weight`), `BlockType.DrawType`, `TextureComputedColor` y `TranslationProperties.Name`; resuelve el nombre legible contra `Server/Languages/<locale>/server.lang` (normalizando el prefijo `server.`). Resultado: `block_name → { display_name, icon_ref, texture_refs, draw_type, fallback_color, group }`.
- Interfaz: `build_catalog() -> BlockCatalog`, `texture_uri(block_name, face) -> Uri`, `icon_uri(block_name) -> Uri`.
- Cachea el catálogo para no recomputar en cada arranque.

### 6.3 Prefab Parser
> Esquema real confirmado en el spike (`docs/spikes/2026-06-13-hytale-formato.md`). La doc web pública era incorrecta (describía una `Palette` de caracteres inexistente).
- Parsea `*.prefab.json` (formato real v8): `version`, `blockIdVersion`, `anchorX/Y/Z`, y `blocks[]` = lista de `{ x, y, z, name, rotation? }` con coordenadas **absolutas** (pueden ser negativas).
- Descarta bloques con `name == "Empty"`; **deriva el tamaño del bounding box** (no existe campo `Size`).
- Lee y valida `version`/`blockIdVersion`; advierte ante versiones no soportadas.
- Interfaz: `parse(path) -> Result<VoxelModel>`.

### 6.4 Materials Calc
- A partir de un `VoxelModel` + la asignación de fases: cuenta bloques por `block_name` (excluyendo `Empty`), total y por fase.
- Une con el catálogo para nombre legible/icono.
- Interfaz: `totals(model) -> Vec<MaterialLine>`, `by_phase(model, phases) -> Map<PhaseId, Vec<MaterialLine>>`.

### 6.5 Repos SQLite
- CRUD de todas las entidades (§8). Migraciones versionadas.
- Operaciones de progreso/checklist atómicas.

### 6.6 Tauri Commands (API frontend)
Ejemplos (no exhaustivo): `get_install_status`, `set_install_path`, `list_builds(filter)`, `get_build(id)`, `get_phase_guide(build_id, phase_id)`, `get_materials(build_id, scope)`, `toggle_favorite(build_id)`, `update_progress(...)`, `set_step_completed(...)`, `set_material_gathered(...)`. Modo curación: `curation_*`.

## 7. Formato interno `VoxelModel`

Estructura propia, compacta, **derivada** del `*.prefab.json` (no es un archivo de Hytale; es nuestro caché de trabajo):

- `size: (u32, u32, u32)` — **derivado** del bounding box de los bloques (min/max por eje).
- `origin: (i32, i32, i32)` — de `anchorX/Y/Z`.
- `blocks`: lista de `{ x, y, z, block_name, rotation }` (coords absolutas; `Empty` ya descartado). `block_name` es el ID técnico de Hytale (p. ej. `Rock_Stone`).
- `phase_index`: array paralelo (o mapa) `block → phase` (resultado de la asignación híbrida, añadido en curación).
- Serialización: **JSON comprimido por build** en el directorio de datos de la app (recomendación del spike: los prefabs reales rondan 1–25 KB; reevaluar formato binario solo si aparecen builds con >100k bloques). SQLite guarda la referencia y los conteos cacheados.

Motivo: una build puede tener miles de bloques; mantenerlos como filas SQLite individuales es ineficiente. Se guardan como blob/archivo y SQLite indexa metadatos + asignación de fases.

## 8. Modelo de datos (SQLite)

Esquema lógico (los tipos/constraints finales se afinan en implementación):

- **`settings`** — `key`, `value` (incluye `hytale_install_path`, versión de catálogo, etc.)
- **`builds`** — `id`, `slug`, `name`, `description`, `category`, `style`, `difficulty`, `estimated_time_min`, `block_count`, `mode` (`survival|creative|both`), `thumbnail_ref`, `author_name`, `author_url`, `source_url`, `license_note`, `voxel_model_ref`, `created_at`, `updated_at`
- **`tags`** — `id`, `name`; **`build_tags`** — `build_id`, `tag_id`
- **`build_images`** — `id`, `build_id`, `path`, `caption`, `order_index`, `is_final`
- **`phases`** — `id`, `build_id`, `order_index`, `name`, `description`
- **`steps`** — `id`, `phase_id`, `order_index`, `title`, `instruction`, `preview_ref`
- **`build_materials`** — `build_id`, `block_id`, `qty` (caché de totales)
- **`phase_materials`** — `phase_id`, `block_id`, `qty` (caché por fase)
- **`user_progress`** — `build_id`, `status` (`not_started|in_progress|completed`), `current_phase_id`, `updated_at`
- **`completed_steps`** — `build_id`, `step_id`, `completed_at`
- **`material_checklist`** — `build_id`, `scope` (`total` o `phase:<id>`), `block_id`, `gathered_qty`
- **`favorites`** — `build_id`, `created_at`

> La asignación bloque→fase **no** vive en SQLite (vive en el `VoxelModel`); `phases`/`steps` guardan la narrativa humana y se enlazan por `phase.order_index` ↔ `phase_index` del modelo.

## 9. Frontend (React + R3F + shadcn)

### 9.1 Pantallas (mapeadas al recorrido del briefing §7)
1. **Onboarding / Locator** — primera ejecución: detectar o seleccionar la instalación de Hytale; estado claro si falta.
2. **Biblioteca** — grid de builds con filtros (categoría, estilo, dificultad, modo) y búsqueda.
3. **Ficha de build** — galería, vista final destacada, dificultad/tiempo/nº bloques, materiales totales, lista de fases, botones *Empezar guía* / *Favorito*, info del autor + atribución/licencia.
4. **Guía paso a paso** — doble panel: **visor 3D** (izquierda) + **panel de paso** (derecha: instrucción, materiales de la fase, checklist, navegación fase/paso, marcar completado). Responde siempre a las 7 preguntas del briefing §24.
5. **Mis builds** — favoritos + en progreso ("Continúa donde lo dejaste").
6. **Modo curación** (interno, tras flag) — §11.

### 9.2 Estado
- **Zustand** — estado de UI/sesión (fase/paso actual, panel, preferencias de visor).
- **TanStack Query** — datos del Core (builds, guías, materiales, progreso) con caché e invalidación.

### 9.3 Tono y copy
Microcopy en **español con tildes** (briefing §19): "Empieza esta build", "Reúne estos materiales", "Fase 2 de 7: levanta la estructura", "Continúa donde lo dejaste".

### 9.4 Estética nativa de Hytale (tema de UI) — D10
Objetivo: que la app **se sienta nativa de Hytale** respetando la EULA y la sección 18 del briefing ("identidad propia inspirada en Hytale", "no copiar assets oficiales", "no parecer app oficial"). Se resuelve en **dos capas**:

**Capa A — Contenido del juego (real, BYO):** todos los **iconos de bloques e items** mostrados en la UI (materiales, checklist, pasos, paletas, tooltips) son los **archivos reales** de `Common/Icons/ItemsGenerated/*.png` leídos de la instalación local y servidos vía `voxelfold-asset://`. Nada de iconos genéricos ni placeholders para el contenido del juego. Si un icono no existe en la instalación, fallback al icono de "bloque desconocido" propio.

**Capa B — Chrome de la aplicación (tema propio "Hytale-like"):** los elementos estructurales de la UI (paneles, botones, tarjetas, marcos, fondos, navegación) usan un **tema visual propio de alta fidelidad** que evoca la estética de Hytale —madera/piedra/pergamino, biselado voxel, esquinas trabajadas, tonos cálidos de fantasía artesanal— construido con:
- **Design tokens** (colores, tipografía, radios, sombras, texturas de borde) sobre Tailwind + shadcn/ui, recogidos en un `DESIGN.md` del proyecto.
- **Tipografía de licencia libre** con carácter fantasía/voxel (p. ej. familias open-source tipo display + una legible para cuerpo); **no** se usan ni redistribuyen las fuentes propietarias de Hytale.
- **Texturas/marcos propios** (madera, piedra, pergamino) generados o de licencia libre, evocando el estilo sin copiar assets oficiales.

> Regla clara: **el contenido del juego es real; el marco de la app es nuestro, con piel Hytale.** Está prohibido empaquetar/redistribuir el HUD, los marcos de UI o las fuentes propietarias de Hytale. El logo de Hytale solo se usa de forma descriptiva, nunca como marca principal (briefing §17).

El tema se definirá con la skill **ui-ux-pro-max** y se congelará en un `DESIGN.md` en la raíz (precedencia absoluta sobre recomendaciones genéricas), antes de construir las pantallas.

## 10. Visor 3D voxel (pieza estrella)

- **react-three-fiber + Three.js**.
- **Rendimiento**: `InstancedMesh` (agrupado por textura/material) + **greedy meshing** para caras visibles → objetivo 60 fps en builds grandes.
- **Texturas reales** servidas vía `voxelfold-asset://`, con `NearestFilter`/`magFilter` nearest (pixel-art nítido, estética Hytale). Mipmaps para distancia.
- **Modos por fase**:
  - *Construcción progresiva*: muestra bloques hasta la fase N.
  - *Resaltar fase actual*: el resto atenuado.
  - *Ghost blocks*: bloques de la fase/paso siguiente translúcidos (anticipa lo que toca colocar).
  - *Aislar capa / sección*.
- **Cámara**: órbita, zoom, encuadre automático según `Size`.
- **Thumbnails/renders** auto-generados offscreen desde el propio visor (no dependemos solo de capturas externas).

## 11. Pipeline de contenido + herramienta de curación interna

Necesario para producir las 20-30 builds (D6, D8). **Modo curación** dentro de la app (tras flag), reutilizando el Core:

1. Cargar `prefab.json` (propio o de comunidad **con permiso**).
2. Parsear → `VoxelModel` + previsualización 3D.
3. **Dividir en fases** (D7): auto-sugerencia por capas/altura + **ajuste manual** (asignar bloques/regiones a fases).
4. Definir **pasos** dentro de cada fase: título, instrucción, preview.
5. Registrar **metadatos**: nombre, categoría, estilo, dificultad, tiempo, modo, **autor + URL + nota de licencia/atribución**.
6. Guardar en SQLite + `VoxelModel` en caché.
7. Generar thumbnails y materiales (total y por fase).

Salida: contenido listo para la biblioteca. El editor **público** para creadores externos queda para Fase 2 del roadmap.

## 12. Estructura del repositorio (monorepo)

```
voxelfold/
├─ src-tauri/                 # Core Rust
│  ├─ src/
│  │  ├─ locator.rs           # §6.1
│  │  ├─ assets.rs            # §6.2
│  │  ├─ prefab.rs            # §6.3
│  │  ├─ materials.rs         # §6.4
│  │  ├─ db/                  # §6.5 (repos + modelos)
│  │  ├─ commands.rs          # §6.6
│  │  └─ asset_protocol.rs    # custom protocol voxelfold-asset://
│  ├─ migrations/             # SQLite
│  └─ tests/                  # tests del Core con fixtures reales del spike
├─ src/                       # Frontend React
│  ├─ routes/                 # pantallas §9.1
│  ├─ viewer/                 # visor R3F §10
│  ├─ components/ui/          # shadcn/ui
│  ├─ stores/                 # Zustand
│  └─ api/                    # binding a comandos Tauri + TanStack Query
├─ content/                   # SOLO metadatos/guías curadas (sin assets de Hytale)
├─ DESIGN.md                  # tema "Hytale-like" congelado (§9.4); precede a recomendaciones genéricas
├─ docs/superpowers/specs/    # este documento y siguientes
└─ README.md                  # incluye disclaimer §2.3
```

## 13. Spike inicial obligatorio (primera tarea)

Antes de fijar el modelo definitivo, inspeccionar la **instalación real de Hytale en el Mac del usuario** y documentar hallazgos en `docs/`:

1. **Ruta real** del `Assets.zip` / carpeta de instalación en macOS (incluida posible capa de compatibilidad).
2. **Estructura real** del zip: confirmar `Common/BlockTextures`, `Icons/ItemsGenerated`, `Server/Item/Items`, `manifest.json`.
3. **Esquema real** de un `prefab.json` de ejemplo (campos exactos, codificación de la matriz y la paleta, sistema de coordenadas).
4. **Nombres/convención** de texturas e iconos por `block_id` (cómo enlazar bloque → PNG).
5. Tamaños típicos (para decidir el formato de `VoxelModel` y si conviene blob binario).

**Entregable del spike:** una nota técnica con los formatos confirmados + 1-2 fixtures reales (prefab + recorte de catálogo) que alimentarán los tests TDD del Core. **No se diseña el parser sobre suposiciones.**

## 14. Alcance del MVP

**Incluye** (briefing §14): biblioteca, fichas, guías por fases, pasos, materiales totales y por fase, checklist de materiales, progreso (pausar/continuar/completar), favoritos, **visor 3D con assets reales locales**, **tema de UI nativo Hytale** (iconos reales BYO + chrome propio "Hytale-like", §9.4), **20-30 builds curadas**, **herramienta de curación interna**, onboarding/locator, disclaimer legal.

**Fuera del MVP** (briefing §14): plugin in-game, marketplace, comentarios, monetización, editor público de creadores, conversión automática Minecraft→prefab para el usuario final, app móvil con assets propios.

**Plataforma de validación:** macOS primero; port a Windows/Linux después.

### Mapeo al roadmap del briefing (§21)
- **Fase 1 (companion de guías):** ✅ es el MVP.
- **Fase 2 (herramientas para creadores):** el "modo curación interno" es la semilla; el editor público llega después.
- **Fase 3 (importación de prefabs):** el Prefab Parser ya existe en el MVP, pero usado por el equipo (curación), no por usuarios.
- **Fases 4-5 (in-game, comunidad/monetización):** fuera de alcance.

## 15. Estrategia de testing

- **TDD en el Core Rust** (lo crítico): `prefab.rs` (parseo + paleta), `materials.rs` (conteos total/fase), `db/` (repos con fixtures), `locator.rs` (resolución de rutas). Fixtures = datos **reales** del spike.
- **Frontend:** tests de componentes (biblioteca, ficha, panel de guía) y un **smoke test** del visor (monta, carga un modelo, navega fases).
- **Integración:** flujo "abrir build → ver materiales → avanzar fase → marcar paso/material → persistencia".

## 16. Fuentes (verificación 2026-06-13)

- Estado/relanzamiento Hytale: hytale.com/news, Wikipedia (Hytale), GameSpot, PCGamesN (roadmap 2026), pebblehost.com.
- Formato prefab.json: hytale.game/en/prefab, hytale-docs.pages.dev/modding/content/prefabs, bisecthosting.com.
- Estructura de asset packs/texturas: britakee-studios.gitbook.io (Hytale Modding Documentation), icedfoxstudios.com, hytalecharts.com.
- Catálogo de bloques: hytalecharts.com/wiki/blocks, hytaleitemids.com, hytale.game/wiki-explorer/blocks, hytale-docs.com.
- Legal: hytale.com/eula, hytale.com/creator-policy, hytale.com/community-guidelines.

## 17. Cuestiones abiertas — RESUELTAS en el spike (2026-06-13)

> Ver `docs/spikes/2026-06-13-hytale-formato.md` para el detalle verificado.

1. **Ruta de instalación en macOS:** ✅ Resuelto — `~/Library/Application Support/Hytale/install/release/package/game/latest/Assets.zip` (instalación **nativa**, no capa de compatibilidad). El Locator usa esta ruta en macOS + fallback manual.
2. **Esquema de la matriz de bloques:** ✅ Resuelto — `blocks[]` = lista explícita de `{x,y,z,name,rotation?}`, coords absolutas (pueden ser negativas), ejes X/Y(alto)/Z, `Empty` = hueco, **sin** `Size` (bounding box) ni `Palette`.
3. **Mapeo `block_name` → textura/icono:** ✅ Resuelto — vía `Server/Item/Items/**/*.json` (`Icon` → `Common/Icons/ItemsGenerated/...`; `BlockType.Textures[]` → `Common/BlockTextures/...`); nombre legible vía `server.lang`.
4. **Formato del `VoxelModel`:** ✅ Resuelto — **JSON comprimido** por build para el MVP (tamaños reales 1–25 KB). Reevaluar binario solo con builds >100k bloques.
5. **`rusqlite` vs `sqlx`:** ✅ Resuelto — **`rusqlite`** (síncrono, simple, sin runtime async; adecuado para app de escritorio local).
