//! Catálogo de bloques: parseo de las definiciones `Server/Item/Items/**/*.json` de Hytale
//! a una estructura `BlockInfo` con icono, texturas, forma y color de fallback.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::core::error::Result;

// ---- Esquema crudo de la definición de bloque ----

#[derive(Debug, Deserialize)]
struct RawBlockDef {
    #[serde(rename = "Icon")]
    icon: Option<String>,
    #[serde(rename = "TranslationProperties")]
    translation: Option<RawTranslation>,
    #[serde(rename = "Categories")]
    categories: Option<Vec<String>>,
    #[serde(rename = "BlockType")]
    block_type: Option<RawBlockType>,
}

#[derive(Debug, Deserialize)]
struct RawTranslation {
    #[serde(rename = "Name")]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawBlockType {
    #[serde(rename = "DrawType")]
    draw_type: Option<String>,
    #[serde(rename = "Group")]
    group: Option<String>,
    #[serde(rename = "Textures")]
    textures: Option<Vec<serde_json::Value>>,
    #[serde(rename = "TextureComputedColor")]
    texture_computed_color: Option<String>,
    #[serde(rename = "CustomModel")]
    custom_model: Option<String>,
    #[serde(rename = "CustomModelTexture")]
    custom_model_texture: Option<Vec<serde_json::Value>>,
    #[serde(rename = "CustomModelScale")]
    custom_model_scale: Option<serde_json::Value>,
    #[serde(rename = "HitboxType")]
    hitbox_type: Option<String>,
    #[serde(rename = "VariantRotation")]
    variant_rotation: Option<String>,
    #[serde(rename = "Tint")]
    tint: Option<Vec<String>>,
    #[serde(rename = "State")]
    state: Option<RawState>,
    #[serde(rename = "Opacity")]
    opacity: Option<String>,
    #[serde(rename = "Light")]
    light: Option<serde_json::Value>,
    #[serde(rename = "Particles")]
    particles: Option<Vec<serde_json::Value>>,
}

/// Expande un hex corto `#rgb` a `#rrggbb`; deja igual los de 6 dígitos. Devuelve `None`
/// si no es un hex válido.
fn expand_hex(s: &str) -> Option<String> {
    let h = s.trim().trim_start_matches('#');
    match h.len() {
        3 => {
            let mut out = String::from("#");
            for c in h.chars() {
                out.push(c);
                out.push(c);
            }
            Some(out)
        }
        6 => Some(format!("#{h}")),
        _ => None,
    }
}

/// ¿Es un sistema de partículas de FUEGO (antorcha/vela/hoguera/farol)? Solo esos llevan
/// llama; portales, gemas, mariposas… no.
fn is_fire_system(system: &str) -> bool {
    let s = system.to_ascii_lowercase();
    [
        "fire", "torch", "candle", "campfire", "ember", "brazier", "flame", "lantern",
    ]
    .iter()
    .any(|k| s.contains(k))
}

/// Color NATIVO de la llama: el `Color` explícito de la partícula si lo trae; si no, se
/// deriva del `SystemId` (p. ej. `Torch_Fire_Green` → verde). `None` si no es fuego.
fn flame_color_for(system: &str, explicit: Option<&str>) -> Option<String> {
    if !is_fire_system(system) {
        return None;
    }
    if let Some(c) = explicit.and_then(expand_hex) {
        return Some(c);
    }
    let s = system.to_ascii_lowercase();
    Some(
        if s.contains("green") {
            "#5ad06a"
        } else if s.contains("blue") {
            "#5aa0ff"
        } else if s.contains("teal") {
            "#3fd6c8"
        } else if s.contains("candle") {
            "#ffcd10"
        } else {
            "#ff8a2a" // naranja: Torch_Fire, Campfire, Fire genérico…
        }
        .to_string(),
    )
}

#[derive(Debug, Deserialize)]
struct RawState {
    #[serde(rename = "Definitions")]
    definitions: Option<std::collections::HashMap<String, RawStateDef>>,
}

#[derive(Debug, Deserialize)]
struct RawStateDef {
    #[serde(rename = "CustomModel")]
    custom_model: Option<String>,
    #[serde(rename = "CustomModelTexture")]
    custom_model_texture: Option<Vec<serde_json::Value>>,
    #[serde(rename = "CustomModelScale")]
    custom_model_scale: Option<serde_json::Value>,
    #[serde(rename = "HitboxType")]
    hitbox_type: Option<String>,
    #[serde(rename = "Tint")]
    tint: Option<Vec<String>>,
    #[serde(rename = "Opacity")]
    opacity: Option<String>,
    #[serde(rename = "Light")]
    light: Option<serde_json::Value>,
    #[serde(rename = "FlipType")]
    flip_type: Option<String>,
}

// ---- Modelo interno ----

/// Un estado de forma de un bloque (escalón/tejado/losa…): su modelo + tipo de volteo.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BlockState {
    pub state: String,
    pub model: String,
    pub model_texture: Option<String>,
    pub model_scale: f32,
    pub hitbox_type: String,
    pub hitbox: Option<BlockHitbox>,
    pub tint: Option<String>,
    pub opacity: Option<String>,
    pub light: bool,
    pub flip: Option<String>,
}

/// Una referencia a una textura de bloque, por cara.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BlockTexture {
    /// `All`, `Top`, `Side`, `Bottom`, etc.
    pub face: String,
    /// Ruta relativa a `Common/` dentro del Assets.zip (p. ej. `BlockTextures/Rock_Stone.png`).
    pub path: String,
    pub weight: u32,
    /// Índice del objeto dentro de `Textures`; agrupa las seis caras de una misma variante.
    pub variant: u32,
}

/// Bounding box de colocación nativo (unión de `BlockBoundingBoxes.Boxes`). Sus límites
/// pueden salir de 0..1: en ese caso Hytale reserva celdas filler para toda la huella.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BlockHitbox {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

/// Información catalogada de un bloque.
#[derive(Debug, Clone, Serialize)]
pub struct BlockInfo {
    pub name: String,
    /// `true` si la definición tiene `BlockType`: es un bloque colocable (no una
    /// herramienta, comida ni item suelto). Permite filtrar la paleta de construcción.
    pub is_block: bool,
    pub display_name: Option<String>,
    /// Clave i18n declarada por la definición (`TranslationProperties.Name`),
    /// p. ej. `server.items.Rock_Stone.name`. Se resuelve contra el `.lang`.
    pub translation_key: Option<String>,
    /// Ruta del icono relativa a `Common/` (campo `Icon`).
    pub icon: Option<String>,
    pub draw_type: Option<String>,
    pub group: Option<String>,
    /// Color promedio (`TextureComputedColor`), útil como fallback del visor.
    pub fallback_color: Option<String>,
    pub categories: Vec<String>,
    pub textures: Vec<BlockTexture>,
    /// Ruta del modelo 3D `.blockymodel` (relativa a `Common/`), si el bloque es Model.
    pub model: Option<String>,
    /// Ruta de la textura del modelo (relativa a `Common/`), si la hay.
    pub model_texture: Option<String>,
    /// Escala que Hytale aplica al modelo personalizado (`CustomModelScale`).
    /// El servidor la transmite al cliente como `modelScale`; 1.0 es el valor por defecto.
    pub model_scale: f32,
    /// ID del asset `Server/Item/Block/Hitboxes/**` usado por el bloque (`Full` por defecto).
    pub hitbox_type: String,
    /// Unión de las cajas del hitbox ya resuelta, incluida la herencia del asset.
    pub hitbox: Option<BlockHitbox>,
    /// Subconjunto de orientaciones permitido por el juego (`NESW`, `UpDownNESW`, `All`…).
    pub variant_rotation: Option<String>,
    /// Color de tinte (`Tint`, p. ej. plantas teñidas de verde), si lo hay.
    pub tint: Option<String>,
    /// Estados de forma (escalones/tejados/losas), cada uno con su modelo.
    pub states: Vec<BlockState>,
    /// Opacidad de render: "Solid" | "Transparent" | "Semitransparent" | "Cutout".
    pub opacity: Option<String>,
    /// `true` si el bloque emite luz (antorchas, farolillos, setas luminosas) → brilla.
    pub light: bool,
    /// Color de la luz emitida (`Light.Color`, p. ej. `#bbaa99`), si lo declara.
    pub light_color: Option<String>,
    /// Color NATIVO de la llama (de la partícula de fuego: `Color` explícito o derivado
    /// del `SystemId`, p. ej. la antorcha del templo es verde). `None` si no tiene fuego.
    pub flame_color: Option<String>,
    /// Escala de la llama (`Particles[0].Scale`), ~0.6-0.8.
    pub flame_scale: Option<f32>,
    /// Desplazamiento vertical de la llama respecto al nodo de anclaje (`PositionOffset.Y`).
    pub flame_offset_y: Option<f32>,
}

/// Catálogo completo: `block_name` → `BlockInfo`.
pub type BlockCatalog = HashMap<String, BlockInfo>;

/// Parsea la definición JSON de un bloque. `display_name` se rellena después con el `.lang`.
pub fn parse_block_def(name: &str, json: &str) -> Result<BlockInfo> {
    // Algunos assets oficiales contienen claves duplicadas (p. ej. `TextureComputedColor` en
    // las telarañas del pre-release 2026-07-17). El cargador del juego conserva un valor; pasar
    // primero por `Value` reproduce ese comportamiento y evita descartar el bloque completo.
    let value: serde_json::Value = serde_json::from_str(json)?;
    let raw: RawBlockDef = serde_json::from_value(value)?;
    let translation_key = raw.translation.and_then(|t| t.name);
    let is_block = raw.block_type.is_some();
    #[allow(clippy::type_complexity)]
    let (
        draw_type,
        group,
        fallback_color,
        textures,
        model,
        model_texture,
        model_scale,
        hitbox_type,
        variant_rotation,
        tint,
        states,
        opacity,
        light,
        light_color,
        flame_color,
        flame_scale,
        flame_offset_y,
    ) = match raw.block_type {
        Some(bt) => {
            let opacity = bt.opacity.clone();
            let light = bt.light.is_some();
            let light_color = bt
                .light
                .as_ref()
                .and_then(|l| l.get("Color"))
                .and_then(|c| c.as_str())
                .and_then(expand_hex);
            let first_particle = bt.particles.as_ref().and_then(|p| p.first());
            let flame_color = first_particle.and_then(|p| {
                let explicit = p.get("Color").and_then(|c| c.as_str());
                let system = p.get("SystemId").and_then(|s| s.as_str()).unwrap_or("");
                flame_color_for(system, explicit)
            });
            let flame_scale = first_particle
                .and_then(|p| p.get("Scale").and_then(|s| s.as_f64()))
                .map(|f| f as f32);
            let flame_offset_y = first_particle
                .and_then(|p| p.get("PositionOffset"))
                .and_then(|o| o.get("Y"))
                .and_then(|y| y.as_f64())
                .map(|f| f as f32);
            let model_texture = bt.custom_model_texture.as_ref().and_then(|list| {
                list.first()
                    .and_then(|v| v.get("Texture"))
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string())
            });
            // El schema oficial también permite los strings especiales NaN/Infinity. No son
            // representables de forma segura en CSS/WebGL, así que cualquier valor no finito
            // o no positivo cae al default del servidor (1.0).
            let model_scale = bt
                .custom_model_scale
                .as_ref()
                .and_then(|value| value.as_f64())
                .filter(|value| value.is_finite() && *value > 0.0)
                .map(|value| value as f32)
                .unwrap_or(1.0);
            let tint = bt
                .tint
                .as_ref()
                .and_then(|t| t.first())
                .map(|s| s.to_string());
            let hitbox_type = bt.hitbox_type.unwrap_or_else(|| "Full".to_string());
            let variant_rotation = bt.variant_rotation;
            let base_model = bt.custom_model.clone();
            let base_model_texture = model_texture.clone();
            let base_tint = tint.clone();
            let base_opacity = opacity.clone();
            let base_light = light;
            let base_hitbox_type = hitbox_type.clone();
            let mut states: Vec<BlockState> = bt
                .state
                .and_then(|s| s.definitions)
                .map(|defs| {
                    defs.into_iter()
                        .filter_map(|(k, v)| {
                            let model = v.custom_model.or_else(|| base_model.clone())?;
                            let state_texture = v.custom_model_texture.as_ref().and_then(|list| {
                                list.first()
                                    .and_then(|entry| entry.get("Texture"))
                                    .and_then(|texture| texture.as_str())
                                    .map(str::to_owned)
                            });
                            let state_scale = v
                                .custom_model_scale
                                .as_ref()
                                .and_then(|value| value.as_f64())
                                .filter(|value| value.is_finite() && *value > 0.0)
                                .map(|value| value as f32)
                                .unwrap_or(model_scale);
                            Some(BlockState {
                                state: k,
                                model,
                                model_texture: state_texture.or_else(|| base_model_texture.clone()),
                                model_scale: state_scale,
                                hitbox_type: v
                                    .hitbox_type
                                    .unwrap_or_else(|| base_hitbox_type.clone()),
                                hitbox: None,
                                tint: v
                                    .tint
                                    .as_ref()
                                    .and_then(|values| values.first().cloned())
                                    .or_else(|| base_tint.clone()),
                                opacity: v.opacity.or_else(|| base_opacity.clone()),
                                light: v.light.is_some() || base_light,
                                flip: v.flip_type,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            states.sort_by(|a, b| a.state.cmp(&b.state));
            (
                bt.draw_type,
                bt.group,
                bt.texture_computed_color,
                parse_textures(bt.textures),
                base_model,
                model_texture,
                model_scale,
                hitbox_type,
                variant_rotation,
                tint,
                states,
                opacity,
                light,
                light_color,
                flame_color,
                flame_scale,
                flame_offset_y,
            )
        }
        None => (
            None,
            None,
            None,
            Vec::new(),
            None,
            None,
            1.0,
            "Full".to_string(),
            None,
            None,
            Vec::new(),
            None,
            false,
            None,
            None,
            None,
            None,
        ),
    };
    Ok(BlockInfo {
        name: name.to_string(),
        is_block,
        display_name: None,
        translation_key,
        icon: raw.icon,
        draw_type,
        group,
        fallback_color,
        categories: raw.categories.unwrap_or_default(),
        textures,
        model,
        model_texture,
        model_scale,
        hitbox_type,
        hitbox: None,
        variant_rotation,
        tint,
        states,
        opacity,
        light,
        light_color,
        flame_color,
        flame_scale,
        flame_offset_y,
    })
}

/// Convierte el array `Textures` (objetos con claves de cara + `Weight`) en `BlockTexture`s.
fn parse_textures(textures: Option<Vec<serde_json::Value>>) -> Vec<BlockTexture> {
    let mut out = Vec::new();
    let Some(list) = textures else {
        return out;
    };
    for (variant, entry) in list.into_iter().enumerate() {
        let Some(obj) = entry.as_object() else {
            continue;
        };
        let weight = obj
            .get("Weight")
            .and_then(|w| w.as_u64())
            .map(|w| w as u32)
            .unwrap_or(1);
        for (face, value) in obj {
            if face == "Weight" {
                continue;
            }
            if let Some(path) = value.as_str() {
                out.push(BlockTexture {
                    face: face.clone(),
                    path: path.to_string(),
                    weight,
                    variant: variant as u32,
                });
            }
        }
    }
    out
}
