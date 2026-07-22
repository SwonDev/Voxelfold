//! Herramienta de desarrollo: extrae de la instalación REAL de Hytale (Assets.zip) el
//! catálogo + los assets de UNA build, a `public/` para poder probar el render real en el
//! navegador (sin Tauri). NO se empaqueta. Uso:
//!   cargo run --example realdata -- <ruta voxels/N.json>

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;

use voxelfold_lib::core::assets::AssetReader;
use voxelfold_lib::core::catalog::BlockInfo;
use voxelfold_lib::core::voxel_store::StoredModel;

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
    let model_path = std::env::args().nth(1).unwrap_or_else(|| {
        home()
            .join("Library/Application Support/com.voxelfold.app/voxels/11.json")
            .to_string_lossy()
            .to_string()
    });
    let out_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public");

    eprintln!("Abriendo {zip:?}");
    let mut reader = AssetReader::open(&zip).expect("abrir Assets.zip");
    let catalog = reader.build_catalog("en-US").expect("catálogo");
    eprintln!("Catálogo: {} bloques", catalog.len());

    let model: StoredModel =
        serde_json::from_str(&fs::read_to_string(&model_path).expect("leer modelo"))
            .expect("parse");

    // Nombres base únicos del modelo.
    let mut names: BTreeSet<String> = BTreeSet::new();
    for b in &model.blocks {
        names.insert(base_name(&b.name));
    }
    // Bloques de TERRENO reales por bioma (MaterialProvider del generador de Hytale: superficie,
    // subsuelo y piedra profunda de Plains1/Desert1/Volcanic1/Taiga1/Boreal1 — ver biomes.ts).
    // Los bloques de árboles/hojas se registran luego al parsear cada prefab.
    for n in [
        // superficies / subsuelos
        "Soil_Grass",
        "Soil_Dirt",
        "Soil_Pebbles",
        "Soil_Sand_White",
        "Soil_Dirt_Dry",
        "Soil_Gravel",
        "Soil_Dirt_Cold",
        "Soil_Pebbles_Frozen",
        "Soil_Snow",
        // piedras profundas reales
        "Rock_Marble",
        "Rock_Sandstone",
        "Rock_Sandstone_White",
        "Rock_Stone",
        "Rock_Quartzite",
        "Rock_Slate",
        // agua (superficie semitransparente)
        "Fluid_Water",
        // cobertura de suelo: hierba alta, flores, helechos y juncos (modelo cross nativo)
        "Plant_Grass_Lush",
        "Plant_Grass_Lush_Tall",
        "Plant_Grass_Arid",
        "Plant_Grass_Dry",
        "Plant_Grass_Jungle",
        "Plant_Grass_Jungle_Tall",
        "Plant_Grass_Rocky",
        "Plant_Grass_Rocky_Short",
        "Plant_Flower_Common_Red",
        "Plant_Flower_Common_Blue",
        "Plant_Flower_Common_Orange",
        "Plant_Flower_Common_Pink",
        "Plant_Flower_Bushy_Yellow",
        "Plant_Flower_Bushy_Violet",
        "Plant_Flower_Bushy_Cyan",
        "Plant_Fern_Forest",
        "Plant_Fern_Jungle",
        "Plant_Fern_Winter",
        "Plant_Reeds_Winter",
    ] {
        names.insert(n.to_string());
    }

    // PREFABS reales de árbol/planta por bioma (mismos que biomes.ts): leer cada uno, registrar sus
    // bloques (para extraer sus texturas) y el propio .prefab.json (para servirlo en dev).
    // PREFABS reales por bioma (mismos que biomes.ts: Plains/Desert/Jungle/Taiga/Boreal).
    let veg_prefabs = [
        // Plains1 (Oak)
        "Server/Prefabs/Trees/Oak/Stage_3/Oak_Stage3_001.prefab.json",
        "Server/Prefabs/Trees/Oak/Stage_2/Oak_Stage2_001.prefab.json",
        "Server/Prefabs/Trees/Beech/Stage_3/Beech_Stage3_001.prefab.json",
        "Server/Prefabs/Trees/Birch/Stage_3/Birch_Stage3_001.prefab.json",
        "Server/Prefabs/Trees/Maple/Stage_3/Maple_Stage3_001.prefab.json",
        // Desert1
        "Server/Prefabs/Trees/Palm/Stage_3/Palm_Stage3_001.prefab.json",
        "Server/Prefabs/Trees/Palm/Stage_3/Palm_Stage3_002.prefab.json",
        "Server/Prefabs/Trees/Dry/Stage_3/Dry_Stage3_001.prefab.json",
        "Server/Prefabs/Trees/Boab/Stage_3/Boab_Stage3_001.prefab.json",
        // Volcanic1 (Jungle)
        "Server/Prefabs/Trees/Bamboo/Stage_3/Bamboo_Stage3_001.prefab.json",
        "Server/Prefabs/Trees/Cedar/Stage_3/Cedar_Stage3_001.prefab.json",
        // Taiga1 (Redwood)
        "Server/Prefabs/Trees/Redwood/Stage_3/Redwood_Stage3_001.prefab.json",
        "Server/Prefabs/Trees/Fir/Stage_3/Fir_Stage3_001.prefab.json",
        // Boreal1 (Fir nevado)
        "Server/Prefabs/Trees/Fir_Snow/Stage_3/Trees_Fir_Stage_3_New_001.prefab.json",
        "Server/Prefabs/Trees/Fir_Snow/Stage_3/Trees_Fir_Stage_3_New_002.prefab.json",
        "Server/Prefabs/Trees/Fir_Snow/Stage_2/Trees_Fir_Stage_2_New_001.prefab.json",
        // Plantas
        "Server/Prefabs/Plants/Bush/Green/Bush_Green_001.prefab.json",
        "Server/Prefabs/Plants/Bush/Lush/Bush_Lush_001.prefab.json",
        "Server/Prefabs/Plants/Bush/Winter/Bush_Winter_001.prefab.json",
        "Server/Prefabs/Plants/Bush/Arid/Bush_Arid_001.prefab.json",
        "Server/Prefabs/Plants/Cacti/Full/Stage_3/Cacti_Full_Stage_3_001.prefab.json",
        "Server/Prefabs/Plants/Mushroom_Large/Green/Stage_1/Mushroom_Large_Green_Stage_1_001.prefab.json",
        "Server/Prefabs/Plants/Vines/Bush_Hanging/Vines_Bush_Hanging_001.prefab.json",
        // Props: peñascos/rocas de Rock_Formations por bioma
        "Server/Prefabs/Rock_Formations/Rocks/Stone/Small/Rocks_Stone_Small_001.prefab.json",
        "Server/Prefabs/Rock_Formations/Rocks/Stone/Large/Rocks_Stone_Large_001.prefab.json",
        "Server/Prefabs/Rock_Formations/Rocks/Sandstone/Small/Rocks_Sandstone_Small_001.prefab.json",
        "Server/Prefabs/Rock_Formations/Rocks/Quartzite/Small/Rocks_Quartzite_Small_001.prefab.json",
        "Server/Prefabs/Rock_Formations/Rocks/Slate/Small/Rocks_Slate_Small_001.prefab.json",
        "Server/Prefabs/Rock_Formations/Rocks/Volcanic/Large/Rocks_Volcanic_Large_001.prefab.json",
    ];
    let mut prefab_assets: Vec<String> = Vec::new();
    for tp in veg_prefabs {
        let Ok(bytes) = reader.read_entry(tp) else {
            continue;
        };
        prefab_assets.push(tp.to_string());
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            if let Some(bs) = v.get("blocks").and_then(|b| b.as_array()) {
                for b in bs {
                    if let Some(nm) = b.get("name").and_then(|n| n.as_str()) {
                        names.insert(base_name(nm));
                    }
                }
            }
        }
    }

    // Catálogo filtrado + assets a extraer (rutas dentro del zip, prefijo Common/).
    let mut sub: BTreeMap<String, &BlockInfo> = BTreeMap::new();
    let mut assets: BTreeSet<String> = BTreeSet::new();
    for pa in &prefab_assets {
        assets.insert(pa.clone());
    }
    // Formas base compartidas (losas/cuartos derivados por resolveBlock).
    assets.insert("Common/Blocks/Structures/Base_Shapes/HalfBlock_Flat_Shaded.blockymodel".into());
    assets.insert("Common/Blocks/Structures/Base_Shapes/QuarterBlock.blockymodel".into());

    // UI NATIVA de Hytale (nine-patch del chrome): botones, paneles, cabecera, tooltip, separador,
    // slot de inventario y checkbox. Se sirven igual que en la app (voxelfold-asset://) pero aquí se
    // espejan a public/hytale para poder VERIFICAR la interfaz nativa en el navegador (dev). Ver
    // lib/hyChrome.ts + index.css. NO se redistribuyen: se leen del Assets.zip local del usuario.
    for ui in [
        "Buttons/Primary@2x.png",
        "Buttons/Primary_Hovered@2x.png",
        "Buttons/Primary_Pressed@2x.png",
        "Buttons/Secondary@2x.png",
        "Buttons/Secondary_Hovered@2x.png",
        "Buttons/Secondary_Pressed@2x.png",
        "Buttons/Tertiary@2x.png",
        "Buttons/Tertiary_Hovered@2x.png",
        "Buttons/Primary_Square@2x.png",
        "Buttons/Primary_Square_Hovered@2x.png",
        "Buttons/Primary_Square_Pressed@2x.png",
        "Buttons/Destructive@2x.png",
        "Buttons/Destructive_Hovered@2x.png",
        "ContainerFullPatch@2x.png",
        "ContainerHeader@2x.png",
        "TooltipDefaultBackground@2x.png",
        "ContainerSectionSeparator@2x.png",
        "BlockSelectorSlotBackground@2x.png",
        "CheckBoxFrame@2x.png",
        "Checkmark@2x.png",
        "ContainerCloseButton@2x.png",
        "RecipesIcon@2x.png",
        "SearchIcon@2x.png",
        "ContainerTitleArrow@2x.png",
        "IconMaskSettings@2x.png",
        "ClearInputIcon@2x.png",
        "IconCheckGreen.png",
        "IconCrossRed.png",
        "BlockSelectorSlotDropIcon@2x.png",
    ] {
        assets.insert(format!("Common/UI/Custom/Common/{ui}"));
    }
    // Iconos de categoría/nav nativos (HyIcon) + marcadores de mapa, para verificar la UI en dev.
    for ic in [
        "Common/Icons/ItemCategories/Shelves.png",
        "Common/Icons/ItemCategories/Blocks.png",
        "Common/Icons/ItemCategories/Hypixel.png",
        "Common/Icons/ItemCategories/Portal.png",
        "Common/Icons/ItemCategories/Items-Recipe.png",
        "Common/Icons/ItemCategories/Editor.png",
        "Common/Icons/ItemCategories/Container.png",
        "Common/Icons/ItemCategories/Build-Walls.png",
        "Common/Icons/ItemCategories/Build-Roofs.png",
        "Common/Icons/ItemCategories/Build-Stairs.png",
        "Common/Icons/ItemCategories/Bench.png",
        "Common/Icons/ItemCategories/Natural-Vegetal.png",
        "Common/Icons/ItemCategories/Items-Tools.png",
        "Common/UI/WorldMap/MapMarkers/Prefab.png",
        "Common/UI/WorldMap/MapMarkers/Home.png",
        // Iconos NATIVOS del editor de Hytale para el toolbar/acciones (HyIcon tool-*).
        "Common/Icons/Items/EditorTools/Paint.png",
        "Common/Icons/Items/EditorTools/Laser.png",
        "Common/Icons/Items/EditorTools/Tint.png",
        "Common/Icons/Items/EditorTools/Line.png",
        "Common/Icons/Items/EditorTools/Extrude.png",
        "Common/Icons/Items/EditorTools/Flood.png",
        "Common/Icons/Items/EditorTools/Sculpt.png",
        "Common/Icons/Items/EditorTools/Selection.png",
        "Common/Icons/Items/EditorTools/Paste.png",
        "Common/Icons/Items/EditorTools/Layers.png",
        "Common/Icons/Items/EditorTools/Revolve.png",
        "Common/Icons/Items/EditorTools/Ruler.png",
        "Common/Icons/ItemsGenerated/Build_GreyLight_Cube.png",
        "Common/UI/Custom/Common/ColorPickerButton@2x.png",
        "Common/Icons/AssetNotifications/Trash@2x.png",
    ] {
        assets.insert(ic.to_string());
    }

    for n in &names {
        let Some(info) = catalog.get(n) else { continue };
        sub.insert(n.clone(), info);
        if let Some(ic) = &info.icon {
            assets.insert(format!("Common/{ic}"));
        }
        for t in &info.textures {
            assets.insert(format!("Common/{}", t.path));
        }
        if let Some(m) = &info.model {
            assets.insert(format!("Common/{m}"));
        }
        if let Some(mt) = &info.model_texture {
            assets.insert(format!("Common/{mt}"));
            // Modelo derivado de la textura del modelo (escaleras/tejados rectos).
            if info.model.is_none() {
                if let Some((dir, _)) = mt.rsplit_once("_Textures/") {
                    assets.insert(format!("Common/{dir}.blockymodel"));
                }
            }
        }
        for s in &info.states {
            assets.insert(format!("Common/{}", s.model));
        }
    }

    // Extraer.
    let mut ok = 0usize;
    let mut miss = 0usize;
    for a in &assets {
        match reader.read_entry(a) {
            Ok(bytes) => {
                let dest = out_root.join("hytale").join(a);
                if let Some(p) = dest.parent() {
                    fs::create_dir_all(p).ok();
                }
                fs::write(&dest, bytes).ok();
                ok += 1;
            }
            Err(_) => miss += 1,
        }
    }

    // catalog.json (array) + model.json para el harness.
    let dir = out_root.join("realbuild");
    fs::create_dir_all(&dir).ok();
    let cat_vec: Vec<&BlockInfo> = sub.values().copied().collect();
    fs::write(
        dir.join("catalog.json"),
        serde_json::to_string(&cat_vec).unwrap(),
    )
    .unwrap();
    fs::write(
        dir.join("model.json"),
        serde_json::to_string(&model).unwrap(),
    )
    .unwrap();

    println!(
        "bloques únicos: {} · catálogo: {} · assets ok: {} · miss: {}",
        names.len(),
        sub.len(),
        ok,
        miss
    );
}
