//! Búsqueda y descarga de prefabs públicos de la comunidad de Hytale.
//!
//! 100% local: NO hay servidor propio. Se consultan APIs PÚBLICAS de GitHub (sin
//! clave, con límite de tasa) donde la comunidad ya publica packs de prefabs en el
//! formato `.prefab.json` del juego. Siempre se conserva la **atribución al autor**
//! (owner del repositorio), la licencia y la URL de origen.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;
use url::Url;

const UA: &str = "Voxelfold (herramienta no oficial de Hytale)";
const MAX_API_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PREFAB_BYTES: u64 = 64 * 1024 * 1024;

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

fn validate_raw_github_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "URL de descarga no válida".to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("raw.githubusercontent.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.port(), None | Some(443))
    {
        return Err(
            "La descarga de comunidad debe usar raw.githubusercontent.com por HTTPS".to_string(),
        );
    }
    Ok(url)
}

/// Un repositorio público con prefabs (resultado de búsqueda).
#[derive(Debug, Serialize)]
pub struct CommunityRepo {
    pub full_name: String,
    pub owner: String,
    pub owner_url: String,
    pub html_url: String,
    pub default_branch: String,
    pub stars: i64,
    pub license: Option<String>,
    pub description: Option<String>,
}

/// Un prefab concreto encontrado dentro de un repositorio público.
#[derive(Debug, Serialize, Deserialize)]
pub struct CommunityPrefab {
    pub name: String,
    pub path: String,
    pub repo_full_name: String,
    pub author: String,
    pub author_url: String,
    pub download_url: String,
    pub source_url: String,
    pub license: Option<String>,
}

fn get_json(url: &str) -> Result<Value, String> {
    let resp = ureq::get(url)
        .set("User-Agent", UA)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("error de red consultando la comunidad: {e}"))?;
    let body = read_limited(resp, MAX_API_BYTES, "respuesta")?;
    serde_json::from_slice(&body).map_err(|e| format!("respuesta no válida: {e}"))
}

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|x| x.to_string())
}

/// Busca repositorios públicos de prefabs de Hytale (GitHub), ordenados por estrellas.
pub fn search_repos(query: &str) -> Result<Vec<CommunityRepo>, String> {
    let q = query.trim();
    let full_q = if q.is_empty() {
        "hytale prefab".to_string()
    } else {
        format!("{q} hytale prefab")
    };
    let url = format!(
        "https://api.github.com/search/repositories?q={}&sort=stars&order=desc&per_page=25",
        urlencoding::encode(&full_q)
    );
    let v = get_json(&url)?;
    let mut out = Vec::new();
    if let Some(items) = v.get("items").and_then(|i| i.as_array()) {
        for it in items {
            let owner_obj = it.get("owner");
            out.push(CommunityRepo {
                full_name: s(it, "full_name").unwrap_or_default(),
                owner: owner_obj
                    .and_then(|o| o.get("login"))
                    .and_then(|x| x.as_str())
                    .unwrap_or_default()
                    .to_string(),
                owner_url: owner_obj
                    .and_then(|o| o.get("html_url"))
                    .and_then(|x| x.as_str())
                    .unwrap_or_default()
                    .to_string(),
                html_url: s(it, "html_url").unwrap_or_default(),
                default_branch: s(it, "default_branch").unwrap_or_else(|| "main".to_string()),
                stars: it
                    .get("stargazers_count")
                    .and_then(|n| n.as_i64())
                    .unwrap_or(0),
                license: it
                    .get("license")
                    .and_then(|l| l.get("spdx_id"))
                    .and_then(|x| x.as_str())
                    .filter(|x| *x != "NOASSERTION")
                    .map(|x| x.to_string()),
                description: s(it, "description"),
            });
        }
    }
    Ok(out)
}

/// Extrae `owner/repo` de una URL o cadena `owner/repo` de GitHub.
fn parse_owner_repo(input: &str) -> Option<(String, String)> {
    let s = input.trim().trim_end_matches('/');
    let tail = s
        .strip_prefix("https://github.com/")
        .or_else(|| s.strip_prefix("http://github.com/"))
        .or_else(|| s.strip_prefix("github.com/"))
        .unwrap_or(s);
    let mut parts = tail.split('/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim().trim_end_matches(".git");
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

/// Obtiene la info de un repositorio público a partir de su URL o `owner/repo`.
pub fn repo_info(input: &str) -> Result<CommunityRepo, String> {
    let (owner, repo) = parse_owner_repo(input).ok_or_else(|| {
        "URL de repositorio no válida (usa owner/repo o github.com/owner/repo)".to_string()
    })?;
    let url = format!("https://api.github.com/repos/{owner}/{repo}");
    let it = get_json(&url)?;
    if it.get("full_name").is_none() {
        return Err("repositorio no encontrado".to_string());
    }
    let owner_obj = it.get("owner");
    Ok(CommunityRepo {
        full_name: s(&it, "full_name").unwrap_or_default(),
        owner: owner_obj
            .and_then(|o| o.get("login"))
            .and_then(|x| x.as_str())
            .unwrap_or(&owner)
            .to_string(),
        owner_url: owner_obj
            .and_then(|o| o.get("html_url"))
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_string(),
        html_url: s(&it, "html_url").unwrap_or_default(),
        default_branch: s(&it, "default_branch").unwrap_or_else(|| "main".to_string()),
        stars: it
            .get("stargazers_count")
            .and_then(|n| n.as_i64())
            .unwrap_or(0),
        license: it
            .get("license")
            .and_then(|l| l.get("spdx_id"))
            .and_then(|x| x.as_str())
            .filter(|x| *x != "NOASSERTION")
            .map(|x| x.to_string()),
        description: s(&it, "description"),
    })
}

/// Lista los `.prefab.json` de un repositorio (vía la API de árboles de Git).
pub fn list_prefabs(
    owner: &str,
    repo: &str,
    branch: &str,
    license: Option<&str>,
) -> Result<Vec<CommunityPrefab>, String> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1");
    let v = get_json(&url)?;
    let html = format!("https://github.com/{owner}/{repo}");
    let author_url = format!("https://github.com/{owner}");
    let mut out = Vec::new();
    if let Some(tree) = v.get("tree").and_then(|t| t.as_array()) {
        for node in tree {
            let Some(path) = node.get("path").and_then(|x| x.as_str()) else {
                continue;
            };
            if !path.ends_with(".prefab.json") {
                continue;
            }
            let name = path
                .rsplit('/')
                .next()
                .unwrap_or(path)
                .trim_end_matches(".prefab.json")
                .replace(['_', '-'], " ");
            let enc = path.replace(' ', "%20");
            out.push(CommunityPrefab {
                name,
                path: path.to_string(),
                repo_full_name: format!("{owner}/{repo}"),
                author: owner.to_string(),
                author_url: author_url.clone(),
                download_url: format!(
                    "https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{enc}"
                ),
                source_url: format!("{html}/blob/{branch}/{enc}"),
                license: license.map(|x| x.to_string()),
            });
        }
    }
    out.sort_by_key(|prefab| prefab.name.to_lowercase());
    Ok(out)
}

/// Descarga el contenido de un prefab (texto JSON) desde su URL cruda.
pub fn download(url: &str) -> Result<String, String> {
    let url = validate_raw_github_url(url)?;
    // Sin redirecciones automáticas: evita que un origen permitido derive a una red privada.
    let resp = ureq::builder()
        .redirects(0)
        .build()
        .get(url.as_str())
        .set("User-Agent", UA)
        .call()
        .map_err(|e| format!("error descargando el prefab: {e}"))?;
    if (300..400).contains(&resp.status()) {
        return Err("La descarga de comunidad intentó redirigir a otro origen".to_string());
    }
    let body = read_limited(resp, MAX_PREFAB_BYTES, "descarga")?;
    String::from_utf8(body).map_err(|_| "La descarga no es JSON UTF-8 válido".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descarga_solo_acepta_raw_github_https() {
        assert!(validate_raw_github_url(
            "https://raw.githubusercontent.com/a/b/main/x.prefab.json"
        )
        .is_ok());
        assert!(
            validate_raw_github_url("http://raw.githubusercontent.com/a/b/main/x.prefab.json")
                .is_err()
        );
        assert!(validate_raw_github_url("https://raw.githubusercontent.com.evil.test/x").is_err());
        assert!(validate_raw_github_url("https://127.0.0.1/x").is_err());
    }
}
