//! Parser de los archivos `server.lang` de Hytale (texto plano `clave = valor`)
//! y resolución del nombre legible de un bloque.

use std::collections::HashMap;

/// Parsea un `.lang` a un mapa clave→valor. Ignora líneas vacías y comentarios `#`.
pub fn parse_lang(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            map.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    map
}

/// Resuelve el nombre legible de un bloque a partir de su `name` técnico.
/// Prueba la clave `items.<name>.name` y la variante con prefijo `server.`.
pub fn display_name(lang: &HashMap<String, String>, block_name: &str) -> Option<String> {
    lang.get(&format!("items.{block_name}.name"))
        .or_else(|| lang.get(&format!("server.items.{block_name}.name")))
        .cloned()
}
