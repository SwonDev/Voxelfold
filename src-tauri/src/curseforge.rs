//! Cliente de la CurseForge Eternal API (`api.curseforge.com`) para buscar y
//! descargar prefabs de Hytale de la comunidad, **acreditando al autor**.
//!
//! La API exige una clave (`x-api-key`). Por ToS no se puede incrustar una clave
//! propia en una app distribuida, así que la clave la aporta el usuario (gratuita)
//! y se guarda en el llavero seguro del sistema operativo. Si un autor desactiva la distribución por API
//! (`downloadUrl` nulo), se deja abrir su página en el navegador.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;
use url::Url;

const CF_API: &str = "https://api.curseforge.com";
const UA: &str = "Voxelfold (herramienta no oficial de Hytale)";
const MAX_API_BYTES: u64 = 16 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES: u64 = 64 * 1024 * 1024;

fn read_limited(resp: ureq::Response, max: u64, label: &str) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    resp.into_reader()
        .take(max + 1)
        .read_to_end(&mut body)
        .map_err(|e| format!("{label} ilegible: {e}"))?;
    if body.len() as u64 > max {
        return Err(format!(
            "{label} supera el límite de {} MiB",
            max / 1024 / 1024
        ));
    }
    Ok(body)
}

fn validate_https_url(value: &str, allowed_host: impl FnOnce(&str) -> bool) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "URL no válida".to_string())?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https"
        || !allowed_host(host)
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.port(), None | Some(443))
    {
        return Err("Origen remoto no permitido".to_string());
    }
    Ok(url)
}

fn validate_download_url(value: &str) -> Result<Url, String> {
    validate_https_url(value, |host| {
        host == "forgecdn.net" || host.ends_with(".forgecdn.net")
    })
}

/// Un prefab de CurseForge (resultado de búsqueda o resolución de URL).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CfPrefab {
    pub mod_id: i64,
    pub file_id: i64,
    pub name: String,
    pub summary: String,
    pub author: String,
    pub author_url: String,
    pub website_url: String,
    pub logo_url: Option<String>,
    /// URL de descarga directa. `None` si el autor desactivó la distribución por API
    /// (entonces hay que abrir `website_url` en el navegador).
    pub download_url: Option<String>,
    pub file_name: String,
    pub downloads: i64,
}

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|x| x.to_string())
}

/// Codifica mínimamente un término de búsqueda para la query string.
fn enc(q: &str) -> String {
    q.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "%20".to_string(),
            other => format!("%{:02X}", other as u32 & 0xFF),
        })
        .collect()
}

fn cf_get(key: &str, url: &str) -> Result<Value, String> {
    let resp = ureq::get(url)
        .set("x-api-key", key)
        .set("Accept", "application/json")
        .set("User-Agent", UA)
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(401, _) | ureq::Error::Status(403, _) => {
                "Clave de CurseForge inválida o sin permiso.".to_string()
            }
            ureq::Error::Status(c, _) => format!("CurseForge respondió {c}"),
            _ => format!("error de red consultando CurseForge: {e}"),
        })?;
    let body = read_limited(resp, MAX_API_BYTES, "respuesta")?;
    serde_json::from_slice(&body).map_err(|e| format!("respuesta no válida: {e}"))
}

/// Descarga el contenido binario de un archivo (zip o json) desde su URL.
pub fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let url = validate_download_url(url)?;
    // La URL llega desde el webview junto al resultado; se vuelve a validar aquí y se bloquean
    // redirecciones para que una respuesta comprometida no pueda saltar a localhost/LAN.
    let resp = ureq::builder()
        .redirects(0)
        .build()
        .get(url.as_str())
        .set("User-Agent", UA)
        .call()
        .map_err(|e| format!("error de red descargando el prefab: {e}"))?;
    if (300..400).contains(&resp.status()) {
        return Err("La descarga de CurseForge intentó redirigir a otro origen".to_string());
    }
    read_limited(resp, MAX_DOWNLOAD_BYTES, "descarga")
}

/// ID del juego Hytale en CurseForge (lo expone `/v1/games`).
fn game_id(key: &str) -> Result<i64, String> {
    let v = cf_get(key, &format!("{CF_API}/v1/games?pageSize=50"))?;
    v.get("data")
        .and_then(|d| d.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|g| s(g, "slug").as_deref() == Some("hytale"))
        })
        .and_then(|g| g.get("id"))
        .and_then(|x| x.as_i64())
        .ok_or_else(|| {
            "CurseForge no expone Hytale en su API todavía (o la clave no es válida).".to_string()
        })
}

/// classId de la categoría "Prefabs" (para acotar la búsqueda). Opcional.
fn prefab_class_id(key: &str, gid: i64) -> Option<i64> {
    let v = cf_get(
        key,
        &format!("{CF_API}/v1/categories?gameId={gid}&classesOnly=true"),
    )
    .ok()?;
    v.get("data")
        .and_then(|d| d.as_array())?
        .iter()
        .find(|c| {
            s(c, "slug").as_deref() == Some("prefabs")
                || s(c, "name")
                    .map(|n| n.eq_ignore_ascii_case("prefabs"))
                    .unwrap_or(false)
        })
        .and_then(|c| c.get("id"))
        .and_then(|x| x.as_i64())
}

fn map_mod(m: &Value) -> Option<CfPrefab> {
    let mod_id = m.get("id")?.as_i64()?;
    let author = m
        .get("authors")
        .and_then(|a| a.as_array())
        .and_then(|a| a.first());
    let file = m
        .get("latestFiles")
        .and_then(|f| f.as_array())
        .and_then(|f| f.first());
    Some(CfPrefab {
        mod_id,
        file_id: file
            .and_then(|f| f.get("id"))
            .and_then(|x| x.as_i64())
            .unwrap_or(0),
        name: s(m, "name").unwrap_or_else(|| "Prefab".to_string()),
        summary: s(m, "summary").unwrap_or_default(),
        author: author
            .and_then(|a| s(a, "name"))
            .unwrap_or_else(|| "Autor desconocido".to_string()),
        author_url: author.and_then(|a| s(a, "url")).unwrap_or_default(),
        website_url: m
            .get("links")
            .and_then(|l| s(l, "websiteUrl"))
            .unwrap_or_default(),
        logo_url: m.get("logo").and_then(|l| s(l, "thumbnailUrl")),
        download_url: file
            .and_then(|f| s(f, "downloadUrl"))
            .filter(|u| !u.is_empty()),
        file_name: file
            .and_then(|f| s(f, "fileName"))
            .unwrap_or_else(|| "prefab.zip".to_string()),
        downloads: m.get("downloadCount").and_then(|x| x.as_i64()).unwrap_or(0),
    })
}

/// Busca prefabs de Hytale por término, ordenados por popularidad (máx. 20).
pub fn search(key: &str, query: &str) -> Result<Vec<CfPrefab>, String> {
    let gid = game_id(key)?;
    let mut url =
        format!("{CF_API}/v1/mods/search?gameId={gid}&pageSize=20&sortField=2&sortOrder=desc");
    if let Some(cid) = prefab_class_id(key, gid) {
        url.push_str(&format!("&classId={cid}"));
    }
    let q = query.trim();
    if !q.is_empty() {
        url.push_str(&format!("&searchFilter={}", enc(q)));
    }
    let v = cf_get(key, &url)?;
    let arr = v
        .get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(arr.iter().filter_map(map_mod).collect())
}

/// Resuelve un prefab a partir de la URL de su página de CurseForge
/// (`curseforge.com/hytale/prefabs/<slug>`), usando el slug.
pub fn from_url(key: &str, url: &str) -> Result<CfPrefab, String> {
    let parsed = validate_https_url(url, |host| {
        host == "curseforge.com" || host == "www.curseforge.com"
    })
    .map_err(|_| "Pega una URL HTTPS válida de CurseForge.".to_string())?;
    let slug = parsed
        .path_segments()
        .and_then(|mut parts| parts.next_back())
        .unwrap_or("");
    if slug.is_empty() {
        return Err("Pega la URL de la página del prefab en CurseForge.".to_string());
    }
    let gid = game_id(key)?;
    let v = cf_get(
        key,
        &format!(
            "{CF_API}/v1/mods/search?gameId={gid}&slug={}&pageSize=5",
            enc(slug)
        ),
    )?;
    v.get("data")
        .and_then(|d| d.as_array())
        .and_then(|a| a.first())
        .and_then(map_mod)
        .ok_or_else(|| format!("No encontré el prefab «{slug}» en CurseForge."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enc_codifica_espacios_y_acentos() {
        assert_eq!(enc("medieval tavern"), "medieval%20tavern");
        assert_eq!(enc("casa"), "casa");
    }

    #[test]
    fn map_mod_extrae_campos_y_download() {
        let m: Value = serde_json::from_str(
            r#"{"id":42,"name":"Tavern","summary":"cozy","downloadCount":1234,
                "authors":[{"name":"Safen","url":"https://cf/u/safen"}],
                "links":{"websiteUrl":"https://cf/p/tavern"},
                "logo":{"thumbnailUrl":"https://cf/l.png"},
                "latestFiles":[{"id":9,"fileName":"tavern.zip","downloadUrl":"https://edge/tavern.zip"}]}"#,
        ).unwrap();
        let p = map_mod(&m).unwrap();
        assert_eq!(p.mod_id, 42);
        assert_eq!(p.author, "Safen");
        assert_eq!(p.download_url.as_deref(), Some("https://edge/tavern.zip"));
        assert_eq!(p.file_name, "tavern.zip");
    }

    #[test]
    fn map_mod_sin_download_url_es_none() {
        let m: Value = serde_json::from_str(
            r#"{"id":1,"name":"X","latestFiles":[{"id":2,"fileName":"x.zip","downloadUrl":null}]}"#,
        )
        .unwrap();
        let p = map_mod(&m).unwrap();
        assert!(p.download_url.is_none());
    }

    #[test]
    fn descarga_solo_acepta_cdn_de_curseforge() {
        assert!(validate_download_url("https://edge.forgecdn.net/files/1/2/x.zip").is_ok());
        assert!(validate_download_url("http://edge.forgecdn.net/files/x.zip").is_err());
        assert!(validate_download_url("https://forgecdn.net.evil.test/x.zip").is_err());
        assert!(validate_download_url("https://127.0.0.1/x.zip").is_err());
    }

    #[test]
    fn url_de_pagina_no_acepta_dominios_parecidos() {
        assert!(
            validate_https_url("https://www.curseforge.com/hytale/prefabs/casa", |host| {
                host == "curseforge.com" || host == "www.curseforge.com"
            })
            .is_ok()
        );
        assert!(
            validate_https_url("https://curseforge.com.evil.test/casa", |host| {
                host == "curseforge.com" || host == "www.curseforge.com"
            })
            .is_err()
        );
    }
}
