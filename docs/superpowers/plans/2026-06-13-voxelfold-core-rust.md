# Plan 2 — Fundación del Core Rust (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Construir el Core Rust que lee Hytale real y entiende su contenido: parsear `*.prefab.json` → `VoxelModel`, calcular materiales, construir el catálogo de bloques (definiciones + nombres `.lang`), leer el `Assets.zip` por entrada y localizar la instalación; todo con TDD sobre los fixtures del spike.

**Architecture:** Módulos puros y testeables bajo `src-tauri/src/core/`, sin acoplarse a Tauri. Tauri solo expondrá comandos finos que llaman al Core. Los tests usan los fixtures sintéticos (`src-tauri/tests/fixtures/`) que replican el esquema real (ver `docs/spikes/2026-06-13-hytale-formato.md`). Las pruebas contra la instalación real van marcadas `#[ignore]`.

**Tech Stack:** Rust 2021, `serde`/`serde_json`, `zip`, `thiserror`. Tests con `cargo test`.

## File Structure

```
src-tauri/src/
├── lib.rs            # declara `mod core;` y registra comandos Tauri
└── core/
    ├── mod.rs        # re-exports
    ├── error.rs      # CoreError (thiserror) + Result
    ├── prefab.rs     # RawPrefab/RawBlock -> VoxelModel (parse, bounding box, excluir Empty)
    ├── materials.rs  # conteo de materiales (totals)
    ├── lang.rs       # parser de server.lang + resolución de display name
    ├── catalog.rs    # parse de definición de bloque -> BlockInfo; BlockCatalog
    ├── assets.rs     # AssetReader: lectura por entrada del Assets.zip + build_catalog
    └── locator.rs    # detección de instalación de Hytale por OS + validación
src-tauri/tests/
└── core_tests.rs     # tests de integración con fixtures (include_str!)
```

---

### Task 1: Tipos de error (`core/error.rs`)
- [ ] Definir `CoreError` (thiserror) con variantes Io, Json, Zip, HytaleNotFound, UnsupportedPrefabVersion, Other; `type Result<T>`.

### Task 2: Prefab Parser (`core/prefab.rs`) — TDD
- [ ] **Test (rojo):** `VoxelModel::from_json(prefab_sintetico)` → 7 bloques (Empty excluido), `size == (2,2,2)`, `origin == (0,0,0)`, contiene `Wood_Darkwood_Stairs` con `rotation == 2`, `version == 8`.
- [ ] **Impl:** `RawPrefab`/`RawBlock` (serde con rename de `anchorX`...), `Block`, `VoxelModel`, `from_json`, `compute_size` (bounding box), `EMPTY_BLOCK`, versiones soportadas.
- [ ] **Verde:** `cargo test`.

### Task 3: Materials Calc (`core/materials.rs`) — TDD
- [ ] **Test (rojo):** `totals(&model)` del fixture → `Rock_Stone=4`, `Wood_Fir_Trunk=2`, `Wood_Darkwood_Stairs=1`; sin `Empty`.
- [ ] **Impl:** `MaterialLine`, `totals` (BTreeMap, orden estable).
- [ ] **Verde.**

### Task 4: Lang Parser (`core/lang.rs`) — TDD
- [ ] **Test (rojo):** `parse_lang(server_sintetico)` ignora `#`/vacías; `display_name(&lang, "Rock_Stone") == Some("Stone")`; resuelve también prefijo `server.`.
- [ ] **Impl:** `parse_lang`, `display_name`.
- [ ] **Verde.**

### Task 5: Catalog (`core/catalog.rs`) — TDD
- [ ] **Test (rojo):** `parse_block_def("Rock_Stone", json)` → `icon == Some("Icons/ItemsGenerated/Rock_Stone.png")`, `draw_type == Some("Cube")`, `textures` con `All` de `Rock_Stone.png`; `Wood_Fir_Trunk` con caras `Top`/`Side`; `Wood_Darkwood_Stairs` `draw_type == "Stairs"`.
- [ ] **Impl:** `RawBlockDef`/`RawBlockType`, `BlockInfo`, `BlockTexture`, `BlockCatalog`, `parse_block_def` (texturas desde `Value`: claves cara→path + `Weight`).
- [ ] **Verde.**

### Task 6: Asset Reader (`core/assets.rs`) — TDD
- [ ] **Test (rojo, unitario):** construir un zip en memoria con `Server/Item/Items/X.json`, `Common/...`, `server.lang`; `AssetReader::open` + `build_catalog` devuelve el bloque con display name resuelto; `read_entry` devuelve bytes.
- [ ] **Test (real, `#[ignore]`):** abre el `Assets.zip` real; cuenta entradas > 50.000; `Rock_Stone` presente con icono.
- [ ] **Impl:** `AssetReader` (envuelve `zip::ZipArchive`), `read_entry(path)`, `build_catalog` (recorre `Server/Item/Items/**/*.json`, une con `.lang`), `icon_path`/`texture_path`.
- [ ] **Verde** (los `#[ignore]` se corren a mano con `--ignored`).

### Task 7: Hytale Locator (`core/locator.rs`) — TDD
- [ ] **Test (rojo):** `candidate_paths()` para macOS incluye `~/Library/Application Support/Hytale/install/release/package/game/latest`; `validate(path)` exige que exista `Assets.zip`.
- [ ] **Test (real, `#[ignore]`):** `locate()` encuentra la instalación del usuario.
- [ ] **Impl:** `HytaleInstall`, `candidate_paths` por `cfg!(target_os)`, `validate`, `locate`.
- [ ] **Verde.**

### Task 8: Wire en `lib.rs` + comandos Tauri
- [ ] Declarar `mod core;`. Añadir comandos finos: `get_install_status`, `parse_prefab_materials(path)` (devuelve materiales de un prefab) como prueba de integración E2E del Core con Tauri. `cargo check`.
- [ ] Commit.

## Definición de "hecho"
- [ ] `cargo test` verde (sin contar `#[ignore]`).
- [ ] `cargo test -- --ignored` verde contra la instalación real (verificación manual).
- [ ] Core desacoplado de Tauri; comandos finos enchufados.
