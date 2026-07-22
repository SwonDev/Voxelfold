# Plan 3 — Capa SQLite (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps con checkbox.

**Goal:** Persistencia local con SQLite (rusqlite): modelo de datos del briefing (builds, tags, imágenes, fases, pasos, materiales cacheados, progreso, pasos completados, checklist de materiales, favoritos), migraciones versionadas y repos CRUD, todo con TDD sobre BD en memoria.

**Architecture:** Módulo `core/db/` desacoplado de Tauri. `rusqlite` con SQLite incrustado (`bundled`), migraciones con `rusqlite_migration`. Conexión compartida vía `Mutex<Connection>` en el estado de Tauri (Plan posterior). Tests con `Connection::open_in_memory()` aplicando migraciones.

**Tech Stack:** `rusqlite = { version = "0.32", features = ["bundled", "serde_json"] }`, `rusqlite_migration = "1.3"`.

## File Structure
```
src-tauri/src/core/db/
├── mod.rs          # open_in_memory/open_at, init (migraciones + WAL + foreign_keys)
├── migrations.rs   # Migrations estáticas (esquema completo, §8 del spec)
├── models.rs       # structs serde: Build, NewBuild, Phase, Step, BuildImage, Progress...
└── repo.rs         # funciones CRUD/consulta
src-tauri/tests/db_tests.rs   # tests de integración (BD en memoria)
```

## Esquema (migración 001) — del spec §8
`settings`, `builds`, `tags`, `build_tags`, `build_images`, `phases`, `steps`,
`build_materials`, `phase_materials`, `user_progress`, `completed_steps`,
`material_checklist`, `favorites`. Claves foráneas con `ON DELETE CASCADE`.

---

### Task 1: Dependencias
- [ ] Añadir `rusqlite` (bundled, serde_json) y `rusqlite_migration` a `Cargo.toml`. `cargo build` (compila SQLite incrustado, primera vez lenta).

### Task 2: Migraciones + init (`db/migrations.rs`, `db/mod.rs`) — TDD
- [ ] **Test (rojo):** `db::open_in_memory()` aplica migraciones; las 13 tablas existen (consultar `sqlite_master`); `PRAGMA foreign_keys` = 1.
- [ ] **Impl:** `MIGRATIONS` con el esquema completo; `open_in_memory()`, `open_at(path)`, `init(conn)` (WAL para archivo, foreign_keys ON, `to_latest`).
- [ ] **Verde.**

### Task 3: Modelos (`db/models.rs`)
- [ ] Structs serde: `NewBuild`, `Build`, `Phase`, `Step`, `BuildImage`, `Progress` (con enum `BuildStatus`), `ChecklistScope`. Derivan Serialize/Deserialize.

### Task 4: Repo de builds (`db/repo.rs`) — TDD
- [ ] **Test (rojo):** `create_build(&conn, NewBuild{...})` devuelve id; `get_build` lo recupera con los mismos campos; `list_builds` lo lista; `slug` único (segundo insert con mismo slug → error).
- [ ] **Impl:** `create_build`, `get_build`, `list_builds` (orden por name), mapeo manual de filas.
- [ ] **Verde.**

### Task 5: Fases y pasos — TDD
- [ ] **Test (rojo):** `add_phase`/`add_step`; `phases_for_build` ordenadas por `order_index`; `steps_for_phase` ordenados; borrar build con CASCADE elimina fases y pasos.
- [ ] **Impl + Verde.**

### Task 6: Progreso, pasos completados y favoritos — TDD
- [ ] **Test (rojo):** `set_progress`/`get_progress` (upsert); `set_step_completed(true/false)` y `completed_steps`; `toggle_favorite` + `is_favorite` + `list_favorites`.
- [ ] **Impl (upserts con `ON CONFLICT`) + Verde.**

### Task 7: Checklist de materiales y materiales cacheados — TDD
- [ ] **Test (rojo):** `set_material_gathered(build, scope, block, qty)` (upsert) + `get_checklist(build, scope)`; `cache_materials` total/fase + lectura.
- [ ] **Impl + Verde.**

### Task 8: Commit
- [ ] `cargo test` verde. Commit.

## Definición de "hecho"
- [ ] Migraciones aplicables en memoria y en archivo.
- [ ] Repos cubren builds, fases, pasos, progreso, favoritos, checklist con tests verdes.
- [ ] Desacoplado de Tauri (la integración con estado va en el Plan de frontend).
