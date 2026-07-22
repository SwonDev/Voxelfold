//! Migraciones del esquema SQLite (versionadas con rusqlite_migration).
//! El esquema implementa el modelo de datos del spec §8.

use rusqlite_migration::{Migrations, M};

/// Esquema inicial (migración 001). No reordenar ni editar migraciones ya publicadas:
/// añadir siempre nuevas migraciones al final.
const SCHEMA_001: &str = r#"
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE builds (
    id                 INTEGER PRIMARY KEY,
    slug               TEXT NOT NULL UNIQUE,
    name               TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    category           TEXT NOT NULL DEFAULT '',
    style              TEXT NOT NULL DEFAULT '',
    difficulty         TEXT NOT NULL DEFAULT '',
    estimated_time_min INTEGER NOT NULL DEFAULT 0,
    block_count        INTEGER NOT NULL DEFAULT 0,
    mode               TEXT NOT NULL DEFAULT 'both',
    thumbnail_ref      TEXT,
    author_name        TEXT,
    author_url         TEXT,
    source_url         TEXT,
    license_note       TEXT,
    voxel_model_ref    TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tags (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE build_tags (
    build_id INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (build_id, tag_id)
);

CREATE TABLE build_images (
    id          INTEGER PRIMARY KEY,
    build_id    INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    path        TEXT NOT NULL,
    caption     TEXT NOT NULL DEFAULT '',
    order_index INTEGER NOT NULL DEFAULT 0,
    is_final    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE phases (
    id          INTEGER PRIMARY KEY,
    build_id    INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 0,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE steps (
    id          INTEGER PRIMARY KEY,
    phase_id    INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 0,
    title       TEXT NOT NULL,
    instruction TEXT NOT NULL DEFAULT '',
    preview_ref TEXT
);

CREATE TABLE build_materials (
    build_id   INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    block_name TEXT NOT NULL,
    qty        INTEGER NOT NULL,
    PRIMARY KEY (build_id, block_name)
);

CREATE TABLE phase_materials (
    phase_id   INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
    block_name TEXT NOT NULL,
    qty        INTEGER NOT NULL,
    PRIMARY KEY (phase_id, block_name)
);

CREATE TABLE user_progress (
    build_id         INTEGER PRIMARY KEY REFERENCES builds(id) ON DELETE CASCADE,
    status           TEXT NOT NULL DEFAULT 'not_started',
    current_phase_id INTEGER REFERENCES phases(id) ON DELETE SET NULL,
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE completed_steps (
    build_id     INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    step_id      INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (build_id, step_id)
);

CREATE TABLE material_checklist (
    build_id     INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    scope        TEXT NOT NULL,
    block_name   TEXT NOT NULL,
    gathered_qty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (build_id, scope, block_name)
);

CREATE TABLE favorites (
    build_id   INTEGER PRIMARY KEY REFERENCES builds(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;

/// Devuelve el conjunto de migraciones de la aplicación.
pub fn migrations() -> Migrations<'static> {
    Migrations::new(vec![M::up(SCHEMA_001)])
}
