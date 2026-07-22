//! Asset Reader: lectura **por entrada** del `Assets.zip` de Hytale (3,2 GB, ~60k archivos)
//! sin extraerlo, y construcción del catálogo de bloques.
//!
//! Nunca redistribuye assets: lee de la instalación local del usuario.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::path::Path;

use zip::ZipArchive;

use crate::core::catalog::{self, BlockCatalog, BlockHitbox};
use crate::core::error::{CoreError, Result};
use crate::core::lang;

/// Locale por defecto para resolver nombres legibles (Hytale no incluye español).
pub const DEFAULT_LOCALE: &str = "en-US";

#[derive(Debug, Clone)]
struct HitboxDefinition {
    parent: Option<String>,
    bounds: Option<BlockHitbox>,
}

fn number_at(value: &serde_json::Value, key: &str) -> Result<f32> {
    let Some(raw) = value.get(key) else {
        // `Vector3d` del codec oficial inicializa los componentes omitidos a cero.
        return Ok(0.0);
    };
    raw.as_f64()
        .filter(|number| number.is_finite())
        .map(|number| number as f32)
        .ok_or_else(|| CoreError::Other(format!("componente {key} no numérico")))
}

/// Parsea la unión de `Boxes` sin perder la herencia: si el hijo no declara cajas,
/// `resolve_hitbox` toma las del padre, igual que el AssetBuilderCodec oficial.
fn parse_hitbox_definition(json: &str) -> Result<HitboxDefinition> {
    let value: serde_json::Value = serde_json::from_str(json)?;
    let parent = value
        .get("Parent")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let bounds = match value.get("Boxes") {
        None | Some(serde_json::Value::Null) => None,
        Some(boxes) => {
            let boxes = boxes
                .as_array()
                .ok_or_else(|| CoreError::Other("Boxes del hitbox no es un array".into()))?;
            if boxes.is_empty() {
                return Err(CoreError::Other("Boxes del hitbox está vacío".into()));
            }
            let mut min = [f32::INFINITY; 3];
            let mut max = [f32::NEG_INFINITY; 3];
            for item in boxes {
                let lo = item
                    .get("Min")
                    .ok_or_else(|| CoreError::Other("caja sin Min".into()))?;
                let hi = item
                    .get("Max")
                    .ok_or_else(|| CoreError::Other("caja sin Max".into()))?;
                let item_min = [
                    number_at(lo, "X")?,
                    number_at(lo, "Y")?,
                    number_at(lo, "Z")?,
                ];
                let item_max = [
                    number_at(hi, "X")?,
                    number_at(hi, "Y")?,
                    number_at(hi, "Z")?,
                ];
                for axis in 0..3 {
                    let lo = item_min[axis];
                    let hi = item_max[axis];
                    if lo > hi {
                        return Err(CoreError::Other("caja con Min mayor que Max".into()));
                    }
                    min[axis] = min[axis].min(lo);
                    max[axis] = max[axis].max(hi);
                }
            }
            Some(BlockHitbox { min, max })
        }
    };
    Ok(HitboxDefinition { parent, bounds })
}

fn resolve_hitbox(
    id: &str,
    definitions: &HashMap<String, HitboxDefinition>,
    cache: &mut HashMap<String, BlockHitbox>,
    visiting: &mut HashSet<String>,
) -> Option<BlockHitbox> {
    if id == "Full" {
        return Some(BlockHitbox {
            min: [0.0, 0.0, 0.0],
            max: [1.0, 1.0, 1.0],
        });
    }
    if let Some(hitbox) = cache.get(id) {
        return Some(hitbox.clone());
    }
    if !visiting.insert(id.to_string()) {
        return None; // ciclo de herencia malformado
    }
    let definition = definitions.get(id)?;
    let resolved = definition.bounds.clone().or_else(|| {
        definition
            .parent
            .as_deref()
            .and_then(|parent| resolve_hitbox(parent, definitions, cache, visiting))
    });
    visiting.remove(id);
    if let Some(hitbox) = &resolved {
        cache.insert(id.to_string(), hitbox.clone());
    }
    resolved
}

/// Fusión de herencia de assets: objetos se combinan recursivamente; escalares y arrays
/// declarados por el hijo sustituyen al padre. Es la semántica de los builders JSON de Hytale.
fn merge_asset_value(base: &mut serde_json::Value, child: &serde_json::Value) {
    match (base, child) {
        (serde_json::Value::Object(base), serde_json::Value::Object(child)) => {
            for (key, value) in child {
                if key == "Parent" {
                    continue;
                }
                match base.get_mut(key) {
                    Some(current) => merge_asset_value(current, value),
                    None => {
                        base.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (base, child) => *base = child.clone(),
    }
}

fn resolve_item_value(
    name: &str,
    raw: &HashMap<String, serde_json::Value>,
    cache: &mut HashMap<String, serde_json::Value>,
    visiting: &mut HashSet<String>,
) -> Result<serde_json::Value> {
    if let Some(value) = cache.get(name) {
        return Ok(value.clone());
    }
    if !visiting.insert(name.to_string()) {
        return Err(CoreError::Other(format!(
            "ciclo de herencia entre definiciones de item: {name}"
        )));
    }
    let child = raw
        .get(name)
        .ok_or_else(|| CoreError::Other(format!("definición de item ausente: {name}")))?;
    let mut resolved = child
        .get("Parent")
        .and_then(serde_json::Value::as_str)
        .and_then(|parent| raw.get(parent).map(|_| parent))
        .map(|parent| resolve_item_value(parent, raw, cache, visiting))
        .transpose()?
        .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()));
    merge_asset_value(&mut resolved, child);
    visiting.remove(name);
    cache.insert(name.to_string(), resolved.clone());
    Ok(resolved)
}

/// Resumen verificable de la compatibilidad entre el `Assets.zip` activo y el parser de
/// Voxelfold. Se muestra en Ajustes para que una actualización de Hytale no pierda bloques
/// silenciosamente.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct CatalogDiagnostics {
    pub asset_entries: usize,
    pub item_definitions: usize,
    pub parsed_items: usize,
    pub parse_failures: usize,
    pub read_failures: usize,
    pub duplicate_names: usize,
    pub block_definitions: usize,
    pub model_definitions: usize,
    pub hitbox_definitions: usize,
    pub multi_cell_block_definitions: usize,
    pub prefab_definitions: usize,
    /// Muestra acotada de problemas para poder adaptar el parser sin registrar assets enteros.
    pub issues: Vec<CatalogIssue>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CatalogIssue {
    pub kind: &'static str,
    pub path: String,
    pub error: String,
}

/// Lee entradas individuales del `Assets.zip`.
pub struct AssetReader<R: Read + Seek> {
    archive: ZipArchive<R>,
}

impl AssetReader<BufReader<File>> {
    /// Abre el `Assets.zip` desde una ruta en disco.
    pub fn open(zip_path: impl AsRef<Path>) -> Result<Self> {
        let file = File::open(zip_path)?;
        let archive = ZipArchive::new(BufReader::new(file))?;
        Ok(Self { archive })
    }
}

impl<R: Read + Seek> AssetReader<R> {
    /// Crea un lector desde cualquier fuente Read+Seek (útil para tests con zip en memoria).
    pub fn from_reader(reader: R) -> Result<Self> {
        let archive = ZipArchive::new(reader)?;
        Ok(Self { archive })
    }

    /// Número de entradas del zip.
    pub fn entry_count(&self) -> usize {
        self.archive.len()
    }

    /// Lee los bytes de una entrada por su ruta exacta dentro del zip.
    pub fn read_entry(&mut self, name: &str) -> Result<Vec<u8>> {
        // Techo defensivo: el `uncompressed_size` de la cabecera del zip NO es de fiar (un
        // Assets.zip manipulado o un .zip de comunidad podría declarar un tamaño gigantesco y
        // reventar la asignación, o ser una «zip bomb»). Reservamos como mucho 16 MiB y acotamos
        // la lectura real a 256 MiB (ninguna entrada legítima de Hytale se acerca a eso).
        const MAX_ENTRY_BYTES: u64 = 256 * 1024 * 1024;
        let mut entry = self
            .archive
            .by_name(name)
            .map_err(|_| CoreError::EntryNotFound(name.to_string()))?;
        let prealloc = entry.size().min(16 * 1024 * 1024) as usize;
        let mut buf = Vec::with_capacity(prealloc);
        (&mut entry)
            .take(MAX_ENTRY_BYTES + 1)
            .read_to_end(&mut buf)?;
        if buf.len() as u64 > MAX_ENTRY_BYTES {
            return Err(CoreError::Other(format!(
                "entrada demasiado grande en Assets.zip: {name} (máximo 256 MiB)"
            )));
        }
        Ok(buf)
    }

    /// Lista las rutas de los prefabs disponibles dentro del zip (`Server/Prefabs/**.prefab.json`).
    pub fn list_prefabs(&self) -> Vec<String> {
        self.archive
            .file_names()
            .filter(|n| n.starts_with("Server/Prefabs/") && n.ends_with(".prefab.json"))
            .map(|s| s.to_string())
            .collect()
    }

    /// Lista los idiomas disponibles del juego (`Server/Languages/{locale}/server.lang`),
    /// ordenados (en-US primero por ser el predeterminado).
    pub fn list_locales(&self) -> Vec<String> {
        let mut out: Vec<String> = self
            .archive
            .file_names()
            .filter_map(|n| {
                n.strip_prefix("Server/Languages/")
                    .and_then(|rest| rest.strip_suffix("/server.lang"))
                    .filter(|loc| !loc.contains('/'))
                    .map(|s| s.to_string())
            })
            .collect();
        out.sort();
        out.dedup();
        if let Some(i) = out.iter().position(|l| l == DEFAULT_LOCALE) {
            out.swap(0, i);
        }
        out
    }

    /// Construye el catálogo de bloques: recorre `Server/Item/Items/**/*.json`,
    /// los parsea y resuelve el nombre legible con el `.lang` del locale dado.
    pub fn build_catalog(&mut self, locale: &str) -> Result<BlockCatalog> {
        self.build_catalog_with_diagnostics(locale)
            .map(|(catalog, _)| catalog)
    }

    /// Construye el catálogo y devuelve métricas de compatibilidad. A diferencia del método
    /// histórico, los archivos incompatibles siguen sin tumbar todo el catálogo, pero ya no
    /// quedan ocultos: se contabilizan como fallos de lectura o parseo.
    pub fn build_catalog_with_diagnostics(
        &mut self,
        locale: &str,
    ) -> Result<(BlockCatalog, CatalogDiagnostics)> {
        // 1) Rutas de definiciones de bloque/item.
        let item_paths: Vec<String> = self
            .archive
            .file_names()
            .filter(|n| n.starts_with("Server/Item/Items/") && n.ends_with(".json"))
            .map(|s| s.to_string())
            .collect();
        let hitbox_paths: Vec<String> = self
            .archive
            .file_names()
            .filter(|n| n.starts_with("Server/Item/Block/Hitboxes/") && n.ends_with(".json"))
            .map(str::to_owned)
            .collect();

        let mut diagnostics = CatalogDiagnostics {
            asset_entries: self.entry_count(),
            item_definitions: item_paths.len(),
            prefab_definitions: self.list_prefabs().len(),
            ..CatalogDiagnostics::default()
        };

        // 2) Tabla de nombres legibles (si falta, catálogo sin display names).
        let lang_path = format!("Server/Languages/{locale}/server.lang");
        let lang_map = match self.read_entry(&lang_path) {
            Ok(bytes) => lang::parse_lang(&String::from_utf8_lossy(&bytes)),
            Err(_) => HashMap::new(),
        };

        // 3) Hitboxes oficiales. Su unión determina la huella multicelda que el servidor
        // rellena al colocar muebles, puertas grandes, bancos, camas, etc.
        let mut hitbox_definitions = HashMap::new();
        for path in hitbox_paths {
            let Some(id) = block_name_from_path(&path) else {
                continue;
            };
            let bytes = match self.read_entry(&path) {
                Ok(bytes) => bytes,
                Err(error) => {
                    diagnostics.read_failures += 1;
                    if diagnostics.issues.len() < 20 {
                        diagnostics.issues.push(CatalogIssue {
                            kind: "read",
                            path,
                            error: error.to_string(),
                        });
                    }
                    continue;
                }
            };
            match parse_hitbox_definition(&String::from_utf8_lossy(&bytes)) {
                Ok(definition) => {
                    hitbox_definitions.insert(id, definition);
                    diagnostics.hitbox_definitions += 1;
                }
                Err(error) => {
                    diagnostics.parse_failures += 1;
                    if diagnostics.issues.len() < 20 {
                        diagnostics.issues.push(CatalogIssue {
                            kind: "parse",
                            path,
                            error: error.to_string(),
                        });
                    }
                }
            }
        }
        let mut hitbox_cache = HashMap::new();

        // 4) Leer todas las definiciones primero para poder resolver `Parent` por nombre.
        // Muchas variantes oficiales solo declaran el delta (cultivos eternos, cofres únicos,
        // muebles especiales…); sin esta herencia perdían modelo, textura, escala u opacidad.
        let mut raw_items = HashMap::<String, serde_json::Value>::new();
        let mut item_source = HashMap::<String, String>::new();
        for path in item_paths {
            let Some(name) = block_name_from_path(&path) else {
                continue;
            };
            let bytes = match self.read_entry(&path) {
                Ok(bytes) => bytes,
                Err(error) => {
                    diagnostics.read_failures += 1;
                    if diagnostics.issues.len() < 20 {
                        diagnostics.issues.push(CatalogIssue {
                            kind: "read",
                            path,
                            error: error.to_string(),
                        });
                    }
                    continue;
                }
            };
            match serde_json::from_slice::<serde_json::Value>(&bytes) {
                Ok(value) => {
                    if raw_items.insert(name.clone(), value).is_some() {
                        diagnostics.duplicate_names += 1;
                    }
                    item_source.insert(name, path);
                }
                Err(error) => {
                    diagnostics.parse_failures += 1;
                    if diagnostics.issues.len() < 20 {
                        diagnostics.issues.push(CatalogIssue {
                            kind: "parse",
                            path,
                            error: error.to_string(),
                        });
                    }
                }
            }
        }

        // 5) Fusionar la cadena de herencia, parsear y resolver nombre + hitbox heredado.
        let mut cat = BlockCatalog::new();
        let mut inherited = HashMap::new();
        let names: Vec<String> = raw_items.keys().cloned().collect();
        for name in names {
            let path = item_source
                .get(&name)
                .cloned()
                .unwrap_or_else(|| name.clone());
            let value =
                match resolve_item_value(&name, &raw_items, &mut inherited, &mut HashSet::new()) {
                    Ok(value) => value,
                    Err(error) => {
                        diagnostics.parse_failures += 1;
                        if diagnostics.issues.len() < 20 {
                            diagnostics.issues.push(CatalogIssue {
                                kind: "parse",
                                path,
                                error: error.to_string(),
                            });
                        }
                        continue;
                    }
                };
            let json = serde_json::to_string(&value)?;
            let mut info = match catalog::parse_block_def(&name, &json) {
                Ok(info) => info,
                Err(error) => {
                    diagnostics.parse_failures += 1;
                    if diagnostics.issues.len() < 20 {
                        diagnostics.issues.push(CatalogIssue {
                            kind: "parse",
                            path,
                            error: error.to_string(),
                        });
                    }
                    continue;
                }
            };
            diagnostics.parsed_items += 1;
            if info.is_block {
                diagnostics.block_definitions += 1;
            }
            if info.model.is_some() {
                diagnostics.model_definitions += 1;
            }
            info.hitbox = resolve_hitbox(
                &info.hitbox_type,
                &hitbox_definitions,
                &mut hitbox_cache,
                &mut HashSet::new(),
            )
            // El servidor degrada un ID desconocido a la caja unitaria por defecto.
            .or_else(|| {
                resolve_hitbox(
                    "Full",
                    &hitbox_definitions,
                    &mut hitbox_cache,
                    &mut HashSet::new(),
                )
            });
            let base_hitbox = info.hitbox.clone();
            for state in &mut info.states {
                state.hitbox = resolve_hitbox(
                    &state.hitbox_type,
                    &hitbox_definitions,
                    &mut hitbox_cache,
                    &mut HashSet::new(),
                )
                .or_else(|| base_hitbox.clone());
            }
            let is_multi_cell = info.hitbox.as_ref().is_some_and(|hitbox| {
                hitbox.min.iter().any(|value| *value < 0.0)
                    || hitbox.max.iter().any(|value| *value > 1.0)
            }) || info.states.iter().any(|state| {
                state.hitbox.as_ref().is_some_and(|hitbox| {
                    hitbox.min.iter().any(|value| *value < 0.0)
                        || hitbox.max.iter().any(|value| *value > 1.0)
                })
            });
            if info.is_block && is_multi_cell {
                diagnostics.multi_cell_block_definitions += 1;
            }
            info.display_name = resolve_display(&lang_map, info.translation_key.as_deref(), &name);
            cat.insert(name, info);
        }
        Ok((cat, diagnostics))
    }
}

/// Deriva el `block_name` técnico desde la ruta de la definición (su file stem).
fn block_name_from_path(path: &str) -> Option<String> {
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

/// Resuelve el nombre legible probando la clave i18n de la definición (con y sin prefijo
/// `server.`) y, como fallback, las claves construidas desde el `block_name`.
fn resolve_display(
    lang_map: &HashMap<String, String>,
    translation_key: Option<&str>,
    block_name: &str,
) -> Option<String> {
    if let Some(key) = translation_key {
        if let Some(v) = lang_map.get(key) {
            return Some(v.clone());
        }
        if let Some(stripped) = key.strip_prefix("server.") {
            if let Some(v) = lang_map.get(stripped) {
                return Some(v.clone());
            }
        }
    }
    lang::display_name(lang_map, block_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;

    fn build_test_zip() -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts = SimpleFileOptions::default();
            w.start_file("Server/Item/Items/Rock/Stone/Rock_Stone.json", opts)
                .unwrap();
            w.write_all(
                br#"{"Icon":"Icons/ItemsGenerated/Rock_Stone.png","TranslationProperties":{"Name":"server.items.Rock_Stone.name"},"BlockType":{"DrawType":"Cube","Textures":[{"All":"BlockTextures/Rock_Stone.png","Weight":1}]}}"#,
            )
            .unwrap();
            w.start_file("Server/Languages/en-US/server.lang", opts)
                .unwrap();
            w.write_all(b"# nombres\nitems.Rock_Stone.name = Stone\n")
                .unwrap();
            w.start_file("Common/BlockTextures/Rock_Stone.png", opts)
                .unwrap();
            w.write_all(b"\x89PNG\r\n\x1a\nFAKE").unwrap();
            w.finish().unwrap();
        }
        buf
    }

    #[test]
    fn build_catalog_resuelve_display_name() {
        let data = build_test_zip();
        let mut reader = AssetReader::from_reader(Cursor::new(data)).unwrap();
        let cat = reader.build_catalog("en-US").unwrap();
        let rs = cat.get("Rock_Stone").expect("Rock_Stone en el catálogo");
        assert_eq!(rs.display_name.as_deref(), Some("Stone"));
        assert_eq!(
            rs.icon.as_deref(),
            Some("Icons/ItemsGenerated/Rock_Stone.png")
        );
        assert_eq!(rs.draw_type.as_deref(), Some("Cube"));
        assert_eq!(rs.model_scale, 1.0);
    }

    #[test]
    fn build_catalog_fusiona_parent_de_items_recursivamente() {
        let mut buf = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut buf));
            let options = SimpleFileOptions::default();
            writer
                .start_file("Server/Item/Items/Template_Base.json", options)
                .unwrap();
            writer
                .write_all(
                    br#"{"BlockType":{"DrawType":"Model","CustomModel":"Blocks/Base.blockymodel","CustomModelTexture":[{"Texture":"Blocks/Base.png"}],"CustomModelScale":0.7,"State":{"Definitions":{"Open":{"CustomModel":"Blocks/Open.blockymodel"}}}}}"#,
                )
                .unwrap();
            writer
                .start_file("Server/Item/Items/Variant.json", options)
                .unwrap();
            writer
                .write_all(
                    br#"{"Parent":"Template_Base","BlockType":{"CustomModelScale":0.9,"State":{"Definitions":{"Closed":{"CustomModel":"Blocks/Closed.blockymodel"}}}}}"#,
                )
                .unwrap();
            writer.finish().unwrap();
        }

        let mut reader = AssetReader::from_reader(Cursor::new(buf)).unwrap();
        let catalog = reader.build_catalog("en-US").unwrap();
        let variant = catalog.get("Variant").unwrap();
        assert_eq!(variant.model.as_deref(), Some("Blocks/Base.blockymodel"));
        assert_eq!(variant.model_texture.as_deref(), Some("Blocks/Base.png"));
        assert_eq!(variant.model_scale, 0.9, "el hijo sobrescribe el escalar");
        let open = variant
            .states
            .iter()
            .find(|state| state.state == "Open")
            .expect("conserva el estado heredado");
        assert_eq!(open.model, "Blocks/Open.blockymodel");
        assert_eq!(open.model_texture.as_deref(), Some("Blocks/Base.png"));
        assert_eq!(open.model_scale, 0.9, "el estado hereda la escala efectiva");
        let closed = variant
            .states
            .iter()
            .find(|state| state.state == "Closed")
            .expect("conserva el estado del hijo");
        assert_eq!(closed.model, "Blocks/Closed.blockymodel");
        assert_eq!(closed.model_texture.as_deref(), Some("Blocks/Base.png"));
        assert_eq!(closed.model_scale, 0.9);
    }

    #[test]
    fn build_catalog_resuelve_hitbox_multicelda_heredado() {
        let mut buf = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut buf));
            let options = SimpleFileOptions::default();
            writer
                .start_file("Server/Item/Items/Furniture/Bed_Test.json", options)
                .unwrap();
            writer
                .write_all(br#"{"BlockType":{"DrawType":"Model","HitboxType":"Bed_Test","VariantRotation":"NESW"}}"#)
                .unwrap();
            writer
                .start_file(
                    "Server/Item/Block/Hitboxes/Furniture/Bed_Base.json",
                    options,
                )
                .unwrap();
            writer
                .write_all(br#"{"Boxes":[{"Min":{"X":-1.4,"Y":0,"Z":0.25},"Max":{"X":0.9,"Y":1.5,"Z":1.75}}]}"#)
                .unwrap();
            writer
                .start_file(
                    "Server/Item/Block/Hitboxes/Furniture/Bed_Test.json",
                    options,
                )
                .unwrap();
            writer.write_all(br#"{"Parent":"Bed_Base"}"#).unwrap();
            writer.finish().unwrap();
        }

        let mut reader = AssetReader::from_reader(Cursor::new(buf)).unwrap();
        let catalog = reader.build_catalog("en-US").unwrap();
        let bed = catalog.get("Bed_Test").unwrap();
        assert_eq!(bed.variant_rotation.as_deref(), Some("NESW"));
        let hitbox = bed.hitbox.as_ref().expect("hitbox heredado");
        assert_eq!(hitbox.min, [-1.4, 0.0, 0.25]);
        assert_eq!(hitbox.max, [0.9, 1.5, 1.75]);
    }

    #[test]
    fn build_catalog_informa_compatibilidad_y_escala_de_modelo() {
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts = SimpleFileOptions::default();
            w.start_file("Server/Item/Items/Chair.json", opts).unwrap();
            w.write_all(
                br#"{"BlockType":{"DrawType":"Model","CustomModel":"Blocks/Chair.blockymodel","CustomModelScale":0.7}}"#,
            )
            .unwrap();
            w.start_file("Server/Item/Items/Broken.json", opts).unwrap();
            w.write_all(br#"{"BlockType": "#).unwrap();
            w.start_file("Server/Prefabs/Demo.prefab.json", opts)
                .unwrap();
            w.write_all(br#"{"version":8,"blocks":[]}"#).unwrap();
            w.finish().unwrap();
        }

        let mut reader = AssetReader::from_reader(Cursor::new(buf)).unwrap();
        let (catalog, diagnostics) = reader
            .build_catalog_with_diagnostics(DEFAULT_LOCALE)
            .unwrap();
        assert_eq!(catalog["Chair"].model_scale, 0.7);
        assert_eq!(diagnostics.item_definitions, 2);
        assert_eq!(diagnostics.parsed_items, 1);
        assert_eq!(diagnostics.parse_failures, 1);
        assert_eq!(diagnostics.block_definitions, 1);
        assert_eq!(diagnostics.model_definitions, 1);
        assert_eq!(diagnostics.prefab_definitions, 1);
    }

    #[test]
    fn build_catalog_tolera_claves_duplicadas_de_assets_oficiales() {
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts = SimpleFileOptions::default();
            w.start_file("Server/Item/Items/Deco/Deco_SpiderWeb.json", opts)
                .unwrap();
            w.write_all(
                br##"{"BlockType":{"DrawType":"Model","TextureComputedColor":"#111111","TextureComputedColor":"#222222"}}"##,
            )
            .unwrap();
            w.finish().unwrap();
        }
        let mut reader = AssetReader::from_reader(Cursor::new(buf)).unwrap();
        let (catalog, diagnostics) = reader.build_catalog_with_diagnostics("en-US").unwrap();
        assert_eq!(diagnostics.parse_failures, 0);
        assert_eq!(
            catalog["Deco_SpiderWeb"].fallback_color.as_deref(),
            Some("#222222")
        );
    }

    #[test]
    fn read_entry_devuelve_bytes_png() {
        let data = build_test_zip();
        let mut reader = AssetReader::from_reader(Cursor::new(data)).unwrap();
        let png = reader
            .read_entry("Common/BlockTextures/Rock_Stone.png")
            .unwrap();
        assert!(png.starts_with(b"\x89PNG"));
    }

    #[test]
    fn read_entry_inexistente_da_error() {
        let data = build_test_zip();
        let mut reader = AssetReader::from_reader(Cursor::new(data)).unwrap();
        assert!(reader.read_entry("no/existe.png").is_err());
    }

    #[test]
    #[ignore = "requiere instalación real de Hytale"]
    fn assets_reales_de_hytale() {
        let install = crate::core::locator::locate().expect("Hytale instalado");
        let mut reader = AssetReader::open(install.assets_zip()).unwrap();
        assert!(
            reader.entry_count() > 50_000,
            "el Assets.zip real tiene ~60k entradas"
        );
        let cat = reader.build_catalog(DEFAULT_LOCALE).unwrap();
        assert!(cat.contains_key("Rock_Stone"), "Rock_Stone debe existir");
        let rs = &cat["Rock_Stone"];
        assert!(rs.icon.is_some(), "Rock_Stone debe tener icono");
        assert!(!rs.textures.is_empty(), "Rock_Stone debe tener texturas");
    }
}
