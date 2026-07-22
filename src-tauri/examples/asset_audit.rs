//! Comprueba que el `Assets.zip` instalado sigue siendo compatible con el parser de Voxelfold.
//! Uso: `cargo run --example asset_audit -- [ruta/a/Assets.zip]`.

use std::path::PathBuf;

use voxelfold_lib::core::{assets::AssetReader, locator};

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
    let (catalog, diagnostics) = reader
        .build_catalog_with_diagnostics("en-US")
        .unwrap_or_else(|error| {
            eprintln!("No se pudo construir el catálogo: {error}");
            std::process::exit(1);
        });

    println!(
        "{}",
        serde_json::to_string_pretty(&diagnostics).expect("serializar diagnóstico")
    );
    eprintln!("Catálogo utilizable: {} bloques", catalog.len());
    if diagnostics.parse_failures > 0 || diagnostics.read_failures > 0 {
        eprintln!("El catálogo contiene definiciones incompatibles o ilegibles.");
        std::process::exit(2);
    }
}
