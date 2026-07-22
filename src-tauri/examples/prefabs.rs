//! Dev: lista los PREFABS de Hytale (Server/Prefabs/**.prefab.json) — árboles, vegetación, props.
//! NO se empaqueta. Uso: cargo run --example prefabs

use std::path::PathBuf;
use voxelfold_lib::core::assets::AssetReader;

#[allow(dead_code)]
fn dump_one(
    reader: &mut AssetReader<std::io::BufReader<std::fs::File>>,
    prefabs: &[String],
    needle: &str,
    out: &str,
) {
    if let Some(p) = prefabs.iter().find(|n| n.contains(needle)) {
        if let Ok(bytes) = reader.read_entry(p) {
            std::fs::write(out, &bytes).ok();
            eprintln!("  {} → {} ({} bytes)", needle, out, bytes.len());
        }
    }
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").expect("HOME"))
}

fn main() {
    let zip = home()
        .join("Library/Application Support/Hytale/install/release/package/game/latest/Assets.zip");
    let mut reader = AssetReader::open(&zip).expect("abrir Assets.zip");
    let prefabs = reader.list_prefabs();
    // Volcar un árbol pequeño de Oak para inspeccionar el formato del .prefab.json
    dump_one(
        &mut reader,
        &prefabs,
        "Trees/Oak/",
        "/tmp/tree_oak.prefab.json",
    );
    dump_one(
        &mut reader,
        &prefabs,
        "Trees/Fir_Snow/",
        "/tmp/tree_fir_snow.prefab.json",
    );
    dump_one(
        &mut reader,
        &prefabs,
        "Plants/Bush/",
        "/tmp/plant_bush.prefab.json",
    );
    // Conteo de bloques de cada Fir_Snow Stage_3 (elegir los más densos).
    eprintln!("=== Fir_Snow Stage_3 conteos ===");
    let firs: Vec<String> = prefabs
        .iter()
        .filter(|n| n.contains("Trees/Fir_Snow/Stage_3/"))
        .cloned()
        .collect();
    for f in &firs {
        if let Ok(bytes) = reader.read_entry(f) {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                let n = v
                    .get("blocks")
                    .and_then(|b| b.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                eprintln!("  {} → {} bloques", f.rsplit('/').next().unwrap_or(f), n);
            }
        }
    }
    eprintln!("Prefabs totales: {}", prefabs.len());
    std::fs::write("/tmp/hytale_prefabs.txt", prefabs.join("\n")).ok();
    eprintln!("Volcado a /tmp/hytale_prefabs.txt");
    // categorías de interés
    let groups: &[(&str, &str)] = &[
        ("ÁRBOLES", "tree|oak|birch|fir|pine|spruce|palm|redwood|maple|beech|willow|acacia|aspen|cedar|jungle"),
        ("VEGETACIÓN", "bush|shrub|fern|flower|grass|plant|foliage|vegetation|sapling|mushroom|cactus|vine"),
        ("ROCAS/PROPS", "rock|boulder|stone|prop|deco|log|stump"),
    ];
    for (label, pat) in groups {
        let parts: Vec<&str> = pat.split('|').collect();
        let hits: Vec<&String> = prefabs
            .iter()
            .filter(|n| {
                let l = n.to_lowercase();
                parts.iter().any(|p| l.contains(p))
            })
            .collect();
        println!("\n=== {label} ({}) ===", hits.len());
        for h in hits.iter().take(50) {
            println!("  {}", h.strip_prefix("Server/Prefabs/").unwrap_or(h));
        }
    }
    // muestra una pizca de TODAS las rutas para entender la estructura
    println!("\n=== muestra de prefabs (primeros 40) ===");
    for p in prefabs.iter().take(40) {
        println!("  {}", p.strip_prefix("Server/Prefabs/").unwrap_or(p));
    }
}
