//! Core de Voxelfold: lógica pura desacoplada de Tauri.
//!
//! Lee y entiende el contenido real de Hytale (prefabs, assets, bloques),
//! sin redistribuir nada: todo se lee de la instalación local del usuario.

pub mod assets;
pub mod catalog;
pub mod curation;
pub mod db;
pub mod error;
pub mod lang;
pub mod locator;
pub mod materials;
pub mod multicell;
pub mod portable;
pub mod prefab;
pub mod seed;
pub mod voxel_store;
