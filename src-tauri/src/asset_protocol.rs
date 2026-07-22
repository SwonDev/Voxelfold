//! Custom protocol `voxelfold-asset://` que sirve PNG (iconos/texturas) leídos
//! **bajo demanda** del `Assets.zip` local de Hytale. Nunca redistribuye nada:
//! los bytes salen de la instalación del usuario en su propia máquina.
//!
//! Formato de URI (macOS/Linux): `voxelfold-asset://localhost/<ruta-dentro-del-zip>`
//! p. ej. `voxelfold-asset://localhost/Common/Icons/ItemsGenerated/Rock_Stone.png`.

use tauri::http::Response;
use tauri::{AppHandle, Manager, Runtime};

use crate::state::AppState;

/// Resuelve una petición del protocolo a una respuesta HTTP con los bytes del asset.
pub fn serve<R: Runtime>(app: &AppHandle<R>, raw_path: &str) -> Response<Vec<u8>> {
    let entry = urlencoding::decode(raw_path)
        .map(|c| c.into_owned())
        .unwrap_or_else(|_| raw_path.to_string());

    let state = app.state::<AppState>();
    let bytes = {
        let mut guard = match state.assets.lock() {
            Ok(g) => g,
            Err(_) => return not_found(),
        };
        match guard.as_mut() {
            Some(reader) => reader.read_entry(&entry).ok(),
            None => None,
        }
    };

    match bytes {
        Some(data) => Response::builder()
            .header("Content-Type", content_type(&entry))
            .header("Access-Control-Allow-Origin", "*")
            // Los recursos oficiales pueden cambiar al actualizar Hytale. La caché JS/GPU
            // evita lecturas repetidas durante la sesión; WebKit no debe conservar bytes de
            // una versión anterior entre reinicios de Voxelfold.
            .header("Cache-Control", "no-cache, no-store, must-revalidate")
            .body(data)
            .unwrap_or_else(|_| not_found()),
        None => not_found(),
    }
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(404)
        .body(Vec::new())
        .expect("respuesta 404 válida")
}

fn content_type(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".json") {
        "application/json"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else {
        "application/octet-stream"
    }
}
