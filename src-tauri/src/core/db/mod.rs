//! Capa de persistencia SQLite (rusqlite). Desacoplada de Tauri.

pub mod migrations;
pub mod models;
pub mod repo;

use std::path::Path;

use rusqlite::Connection;

use crate::core::error::{CoreError, Result};

/// Aplica pragmas de sesión y migraciones a una conexión.
fn init(conn: &mut Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrations::migrations()
        .to_latest(conn)
        .map_err(|e| CoreError::Migration(e.to_string()))?;
    Ok(())
}

/// Abre una BD en memoria ya migrada (para tests).
pub fn open_in_memory() -> Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    init(&mut conn)?;
    Ok(conn)
}

/// Abre (o crea) una BD en disco, con WAL, ya migrada.
pub fn open_at(path: impl AsRef<Path>) -> Result<Connection> {
    let mut conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    init(&mut conn)?;
    Ok(conn)
}
