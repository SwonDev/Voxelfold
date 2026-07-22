# Lanzamientos de Voxelfold

Voxelfold usa dos firmas independientes:

1. **Developer ID Application + notarización de Apple**, para que Gatekeeper acepte el `.app` y el `.dmg` descargados.
2. **Ed25519 de Tauri**, para que la aplicación solo instale paquetes publicados por Voxelfold.

La clave privada Ed25519 no pertenece al repositorio. En el equipo de desarrollo está cifrada en
`~/Library/Application Support/Voxelfold Release/updater.key`; su contraseña está en macOS
Keychain con el servicio `com.swondev.voxelfold.updater-signing`.

## Secretos de GitHub Actions

Configura estos secretos sin pegarlos en archivos, issues ni logs:

- `APPLE_CERTIFICATE`: certificado **Developer ID Application** exportado como `.p12` y codificado en Base64.
- `APPLE_CERTIFICATE_PASSWORD`: contraseña del `.p12`.
- `KEYCHAIN_PASSWORD`: contraseña aleatoria y exclusiva del llavero efímero de CI.
- `APPLE_ID`: cuenta de Apple Developer.
- `APPLE_PASSWORD`: contraseña específica para aplicaciones.
- `APPLE_TEAM_ID`: identificador del equipo de Apple Developer.
- `TAURI_SIGNING_PRIVATE_KEY`: contenido de la clave privada Ed25519 cifrada.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: contraseña de esa clave.

## Procedimiento

1. Actualiza las tres versiones (`package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`).
2. Ejecuta `npm run release:check` y todas las puertas de calidad.
3. Crea y sube el tag `vX.Y.Z`.
4. El workflow `Publicar Voxelfold` compila Apple Silicon e Intel, firma, notariza y crea un
   **borrador** de GitHub Release con los paquetes del updater y `latest.json`.
5. Revisa el borrador y publícalo. Solo entonces `releases/latest` empieza a ofrecerlo a usuarios.

No se deben adjuntar `Assets.zip`, el shared source de Hytale ni recursos extraídos del juego: la
aplicación los lee de la instalación local de cada usuario.
