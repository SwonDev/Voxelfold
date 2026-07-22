//! Colección curada de presets: construcciones REALES de Hytale (de aldeas NPC y
//! casas de bioma) que el usuario tiene en su instalación local. No se incrusta
//! geometría — cada entrada se resuelve contra los prefabs reales del Assets.zip
//! por un fragmento de ruta, y se importa con todos los arreglos de render
//! (orientación 0-11, filtro de marcadores, paja `flat`, etc.).
//!
//! Curadas a mano para que sean edificios LIMPIOS y autónomos (no ruinas, mazmorras,
//! casas-árbol Kweebec ni chozas sobre pilotes), verificados en el visor.

use std::collections::HashSet;

/// Una entrada curada: metadatos en español + el fragmento de ruta que identifica
/// el prefab real a importar.
pub struct CuratedBuild {
    /// Substring (case-insensitive) de la ruta del prefab que lo identifica.
    pub match_fragment: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub category: &'static str,
    pub style: &'static str,
    pub difficulty: &'static str,
    pub estimated_time_min: i64,
    pub phases: u32,
}

/// Presets: casas reales de Hytale, limpias y entendibles, de fácil a media.
pub const CURATED: &[CuratedBuild] = &[
    CuratedBuild {
        match_fragment: "Npc/Outlander/Houses/Tier0",
        name: "Choza outlander",
        description: "Refugio outlander básico de arcilla y madera con tejado de paja. El primer hogar del asentamiento.",
        category: "Vivienda",
        style: "Outlander",
        difficulty: "Fácil",
        estimated_time_min: 25,
        phases: 5,
    },
    CuratedBuild {
        match_fragment: "Npc/Outlander/Houses/Tier1",
        name: "Casa outlander",
        description: "Vivienda outlander de muros de terracota, cimientos de piedra y cubierta de paja a dos aguas.",
        category: "Vivienda",
        style: "Outlander",
        difficulty: "Fácil",
        estimated_time_min: 35,
        phases: 6,
    },
    CuratedBuild {
        match_fragment: "Npc/Outlander/Houses/Tier2",
        name: "Casa outlander (mediana)",
        description: "Casa outlander de dos cuerpos con entramado de madera y tejado de paja. Más amplia y trabajada.",
        category: "Vivienda",
        style: "Outlander",
        difficulty: "Media",
        estimated_time_min: 50,
        phases: 6,
    },
    CuratedBuild {
        match_fragment: "Incidental/Grasslands/Houses/Plains",
        name: "Casa de llanura",
        description: "Casa de aldea de pradera con entramado de madera y cubierta de paja. Un clásico acogedor.",
        category: "Vivienda",
        style: "Pradera",
        difficulty: "Media",
        estimated_time_min: 40,
        phases: 6,
    },
    CuratedBuild {
        match_fragment: "Npc/Feran/Tier2/Hut",
        name: "Choza feran del desierto",
        description: "Tienda-cúpula feran de paja sobre estructura de madera. Ligera y distintiva, de los nómadas del desierto.",
        category: "Vivienda",
        style: "Feran",
        difficulty: "Fácil",
        estimated_time_min: 30,
        phases: 5,
    },
    CuratedBuild {
        match_fragment: "Incidental/Basalt/House/Incidental_Basalt_001",
        name: "Casa de basalto",
        description: "Vivienda de piedra basáltica oscura de un bioma volcánico. Robusta y sobria.",
        category: "Vivienda",
        style: "Basalto",
        difficulty: "Media",
        estimated_time_min: 40,
        phases: 6,
    },
];

/// Encuentra el primer prefab cuya ruta contiene el fragmento (case-insensitive) y
/// que no haya sido ya asignado a otra entrada.
pub fn resolve<'a>(
    prefabs: &'a [String],
    fragment: &str,
    used: &HashSet<String>,
) -> Option<&'a String> {
    let f = fragment.to_lowercase();
    prefabs
        .iter()
        .find(|p| !used.contains(*p) && p.to_lowercase().contains(&f))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragmentos_unicos() {
        let mut seen = HashSet::new();
        for cb in CURATED {
            assert!(
                seen.insert(cb.match_fragment),
                "fragmento duplicado: {}",
                cb.match_fragment
            );
        }
    }

    #[test]
    fn resolve_encuentra_y_salta_usados() {
        let prefabs = vec![
            "Server/Prefabs/Npc/Outlander/Houses/Tier1/Outlander_Houses_Tier1_001.prefab.json"
                .to_string(),
            "Server/Prefabs/Npc/Outlander/Houses/Tier1/Outlander_Houses_Tier1_002.prefab.json"
                .to_string(),
        ];
        let mut used = HashSet::new();
        let a = resolve(&prefabs, "Npc/Outlander/Houses/Tier1", &used)
            .unwrap()
            .clone();
        used.insert(a.clone());
        let b = resolve(&prefabs, "Npc/Outlander/Houses/Tier1", &used).unwrap();
        assert_ne!(&a, b);
        assert!(resolve(&prefabs, "Inexistente", &used).is_none());
    }
}
