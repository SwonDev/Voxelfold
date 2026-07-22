//! Companion de bloques: trae la descripción / cómo se consigue desde la wiki pública
//! `hytaleguide.net` (bajo demanda, con caché local). El juego no trae descripciones;
//! la wiki sí. Se acredita la fuente. Sin servidor propio (igual que CurseForge/comunidad).

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;

const UA: &str = "Voxelfold (herramienta no oficial de Hytale)";

#[derive(Serialize, Deserialize, Clone)]
pub struct BlockWiki {
    pub description: String,
    pub source_url: String,
    pub source: String,
}

/// Slug de la wiki a partir del nombre legible (kebab-case del display name).
fn slugify(display: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in display.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// Quita etiquetas HTML, decodifica algunas entidades y colapsa espacios.
fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&nbsp;", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Extrae SOLO la descripción de la ficha: el texto entre "{Nombre} is an item…" y la
/// siguiente sección (Game Identifier / Crafting Recipe / Properties), sin nav ni migas.
fn extract_description(html: &str, name: &str) -> Option<String> {
    let text = strip_tags(html);
    let start = text
        .find(&format!("{name} is an item"))
        .or_else(|| text.find("is an item in Hytale"))?;
    let rest = &text[start..];
    let end = [
        "Game Identifier",
        "Crafting Recipe",
        "Properties",
        "See all item",
        "Discord",
        "Related ",
    ]
    .iter()
    .filter_map(|m| rest.find(m))
    .min()
    .unwrap_or(rest.len());
    let desc = rest[..end].trim().trim_end_matches(['.', ' ']).to_string();
    if desc.len() < 20 {
        None
    } else {
        Some(format!("{desc}."))
    }
}

/// Obtiene (con caché en `cache_dir`) la ficha de la wiki para un bloque por su nombre
/// legible. Devuelve `None` si no hay red, da 404 o no se encuentra descripción.
pub fn fetch(cache_dir: &Path, display_name: &str) -> Option<BlockWiki> {
    let slug = slugify(display_name);
    if slug.is_empty() {
        return None;
    }
    let cache_file = cache_dir.join(format!("{slug}.json"));
    if let Ok(bytes) = std::fs::read(&cache_file) {
        if let Ok(w) = serde_json::from_slice::<BlockWiki>(&bytes) {
            return Some(w);
        }
    }
    let url = format!("https://hytaleguide.net/items/{slug}");
    let html = ureq::get(&url)
        .set("User-Agent", UA)
        .timeout(Duration::from_secs(10))
        .call()
        .ok()?
        .into_string()
        .ok()?;
    let description = extract_description(&html, display_name)?;
    let w = BlockWiki {
        description,
        source_url: url,
        source: "hytaleguide.net".to_string(),
    };
    let _ = std::fs::create_dir_all(cache_dir);
    let _ = std::fs::write(&cache_file, serde_json::to_vec(&w).unwrap_or_default());
    Some(w)
}
