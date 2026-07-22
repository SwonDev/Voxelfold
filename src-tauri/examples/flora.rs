//! Herramienta de desarrollo: vuelca el catálogo COMPLETO de Hytale y lista los bloques de
//! vegetación/terreno (troncos, hojas, flores, hierba, rocas…) para diseñar entornos por bioma.
//! NO se empaqueta. Uso: cargo run --example flora

use std::collections::BTreeSet;
use std::path::PathBuf;

use voxelfold_lib::core::assets::AssetReader;

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").expect("HOME"))
}

fn base_name(name: &str) -> String {
    let raw = name.strip_prefix('*').unwrap_or(name);
    match raw.find("_State_Definitions_") {
        Some(i) => raw[..i].to_string(),
        None => raw.to_string(),
    }
}

fn main() {
    let zip = home()
        .join("Library/Application Support/Hytale/install/release/package/game/latest/Assets.zip");
    let mut reader = AssetReader::open(&zip).expect("abrir Assets.zip");
    let catalog = reader.build_catalog("en-US").expect("catálogo");
    eprintln!("Catálogo total: {} entradas", catalog.len());

    let names: BTreeSet<String> = catalog.keys().map(|k| base_name(k)).collect();
    eprintln!("Nombres base únicos: {}", names.len());
    // Volcar todos los nombres a un archivo para análisis con grep.
    let dump: String = names.iter().cloned().collect::<Vec<_>>().join("\n");
    std::fs::write("/tmp/hytale_blocks.txt", dump).ok();
    // Catálogo completo (con texturas/modelos) para inspeccionar detalles.
    let full: Vec<&voxelfold_lib::core::catalog::BlockInfo> = catalog.values().collect();
    std::fs::write(
        "/tmp/hytale_catalog.json",
        serde_json::to_string(&full).unwrap(),
    )
    .ok();
    eprintln!("Volcado a /tmp/hytale_blocks.txt y /tmp/hytale_catalog.json");

    let groups: &[(&str, &str)] = &[
        ("ÁRBOLES/TRONCOS", "tree|wood|log|trunk|bark|branch|stump|timber"),
        ("HOJAS/FOLLAJE", "leaf|leaves|foliage|frond|canopy|needle"),
        ("FLORES/PLANTAS", "flower|plant|bush|shrub|fern|sapling|sprout|vine|ivy|crop|mushroom|cattail|reed|tallgrass|grass_"),
        ("TERRENO/SUELO", "soil|grass|dirt|sand|snow|ice|gravel|clay|mud|loam|moss|pathway|soil_"),
        ("ROCA/PIEDRA", "rock|stone|cobble|granite|basalt|slate|marble|boulder|ore|crystal|gem"),
        ("AGUA/HIELO", "water|fluid|ice|frost|liquid"),
        ("DESIERTO/CACTUS", "cactus|sand|dune|palm|dead|dry|husk|bone"),
        ("NIEVE/FRÍO", "snow|ice|frost|frozen|pine|spruce|fir|conifer"),
    ];

    for (label, pat) in groups {
        let parts: Vec<&str> = pat.split('|').collect();
        let hits: Vec<&String> = names
            .iter()
            .filter(|n| {
                let l = n.to_lowercase();
                parts.iter().any(|p| l.contains(p))
            })
            .collect();
        println!("\n=== {label} ({}) ===", hits.len());
        for h in hits.iter().take(80) {
            println!("  {h}");
        }
    }
}
