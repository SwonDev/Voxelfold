//! Verificación de desarrollo: comprueba que el fetch+parse de la wiki funciona.
//! cargo run --example wikicheck -- "Stone" "Softwood Planks" "Stone Brick"
use voxelfold_lib::wiki;

fn main() {
    let cache = std::env::temp_dir().join("voxelfold_wikicheck");
    let names: Vec<String> = std::env::args().skip(1).collect();
    let names = if names.is_empty() {
        vec![
            "Stone".into(),
            "Softwood Planks".into(),
            "Marble Brick".into(),
        ]
    } else {
        names
    };
    for n in &names {
        match wiki::fetch(&cache, n) {
            Some(w) => println!(
                "\n[{n}] OK ({})\n  {}\n  {}",
                w.source, w.source_url, w.description
            ),
            None => println!("\n[{n}] sin ficha (sin red, 404 o no parseable)"),
        }
    }
}
