//! Auditoría de cobertura del render sobre el `Assets.zip` real de Hytale.
//!
//! Comprueba todas las referencias declaradas de iconos, texturas y modelos, resume
//! las caras/variantes de textura y detecta bloques colocables sin fuente visual.
//! Uso: `cargo run --example render_audit -- [ruta/a/Assets.zip]`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use voxelfold_lib::core::{
    assets::AssetReader, locator, multicell::collapse_prefab_fillers, prefab::VoxelModel,
};

fn main() {
    let path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .or_else(|| locator::locate().ok().map(|install| install.assets_zip()))
        .unwrap_or_else(|| {
            eprintln!("No se encontró Hytale. Indica la ruta de Assets.zip.");
            std::process::exit(1);
        });

    let mut reader = AssetReader::open(&path).unwrap_or_else(|error| {
        eprintln!("No se pudo abrir {}: {error}", path.display());
        std::process::exit(1);
    });
    let catalog = reader.build_catalog("en-US").unwrap_or_else(|error| {
        eprintln!("No se pudo construir el catálogo: {error}");
        std::process::exit(1);
    });

    let mut refs = BTreeSet::new();
    let mut faces = BTreeMap::<String, usize>::new();
    let mut weighted_blocks = 0usize;
    let mut weighted_names = Vec::new();
    let mut without_visual = Vec::new();

    for block in catalog.values().filter(|block| block.is_block) {
        if block.textures.is_empty()
            && block.model.is_none()
            && block.model_texture.is_none()
            && block.states.is_empty()
        {
            without_visual.push(block.name.clone());
        }
        if let Some(icon) = &block.icon {
            refs.insert(format!("Common/{icon}"));
        }
        if block.textures.iter().any(|texture| texture.weight != 1) {
            weighted_blocks += 1;
            weighted_names.push(block.name.clone());
        }
        for texture in &block.textures {
            *faces.entry(texture.face.clone()).or_default() += 1;
            refs.insert(format!("Common/{}", texture.path));
        }
        if let Some(model) = &block.model {
            refs.insert(format!("Common/{model}"));
        }
        if let Some(texture) = &block.model_texture {
            refs.insert(format!("Common/{texture}"));
        }
        for state in &block.states {
            refs.insert(format!("Common/{}", state.model));
            if let Some(texture) = &state.model_texture {
                refs.insert(format!("Common/{texture}"));
            }
        }
    }

    let mut missing = Vec::new();
    for path in &refs {
        if reader.read_entry(path).is_err() {
            missing.push(path.clone());
        }
    }

    // Los prefabs v8 serializan las celdas filler con el mismo bloque/rotación que el ancla.
    // Auditar TODO el corpus permite medir cuántos modelos habrían quedado superpuestos si el
    // pipeline no reconstruyera el offset que Hytale conserva internamente.
    let prefabs = reader.list_prefabs();
    let mut prefab_parse_failures = 0usize;
    let mut multicell_prefabs = 0usize;
    let mut filler_copies = 0usize;
    let mut multicell_samples = Vec::new();
    for path in &prefabs {
        let Ok(bytes) = reader.read_entry(path) else {
            prefab_parse_failures += 1;
            continue;
        };
        let Ok(json) = std::str::from_utf8(&bytes) else {
            prefab_parse_failures += 1;
            continue;
        };
        let Ok(mut model) = VoxelModel::from_json(json) else {
            prefab_parse_failures += 1;
            continue;
        };
        let removed = collapse_prefab_fillers(&mut model, &catalog);
        if removed > 0 {
            multicell_prefabs += 1;
            filler_copies += removed;
            if multicell_samples.len() < 40 {
                multicell_samples.push((path.clone(), removed));
            }
        }
    }

    println!(
        "Bloques colocables: {}",
        catalog.values().filter(|b| b.is_block).count()
    );
    println!("Referencias visuales únicas: {}", refs.len());
    println!("Referencias ausentes: {}", missing.len());
    println!("Bloques con texturas ponderadas: {weighted_blocks}");
    for name in weighted_names.iter().take(40) {
        println!("  variante ponderada: {name}");
    }
    println!(
        "Caras declaradas: {}",
        serde_json::to_string(&faces).unwrap()
    );
    println!("Bloques sin fuente visual: {}", without_visual.len());
    println!("Prefabs auditados: {}", prefabs.len());
    println!("Prefabs con fillers multicelda: {multicell_prefabs}");
    println!("Copias filler que no deben renderizarse: {filler_copies}");
    println!("Prefabs ilegibles/no parseables: {prefab_parse_failures}");
    for name in without_visual.iter().take(40) {
        println!("  sin visual: {name}");
    }
    for path in missing.iter().take(40) {
        println!("  ausente: {path}");
    }
    for (path, removed) in multicell_samples {
        println!("  multicelda: {path} → {removed} fillers");
    }

    if !missing.is_empty() {
        std::process::exit(2);
    }
}
