# Contribuir a Voxelfold

Gracias por ayudar a mejorar Voxelfold. El proyecto prioriza precisión visual, fluidez del editor, compatibilidad futura y una experiencia clara para constructores.

## Antes de empezar

1. Busca una incidencia existente y describe el comportamiento que quieres corregir o ampliar.
2. Mantén cada cambio centrado en un problema verificable.
3. Lee `DESIGN.md` antes de modificar la interfaz.
4. No copies recursos desde Hytale Shared Source ni desde una instalación local.

## Entorno

```bash
npm ci
npm run test:frontend
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
```

Para comprobar visuales reales se necesita una instalación autorizada de Hytale. Los fixtures del repositorio solo pueden contener datos mínimos creados específicamente para las pruebas.

## Criterios de aceptación

- TypeScript estricto y Rust sin avisos de Clippy.
- Funciones pequeñas, responsabilidades separadas y errores recuperables.
- Accesibilidad por teclado, foco visible y nombres accesibles para controles nuevos.
- Sin regresiones de FPS, draw calls o tiempo de interacción en el editor 3D.
- Pruebas para lógica nueva y casos límite razonables.
- Documentación actualizada cuando cambie un contrato, formato o flujo de usuario.

## Contenido prohibido

No incluyas en commits, incidencias ni pull requests:

- Texturas, iconos, modelos, sonidos, prefabs o archivos comprimidos de Hytale.
- Tokens, contraseñas, certificados, claves privadas o archivos `.env`.
- Rutas absolutas, datos personales, direcciones de correo o bases de datos locales.
- Capturas que revelen contenido privado o repositorios restringidos.
- Firmas automáticas, trailers de coautoría no humana o atribuciones de asistentes.

Ejecuta siempre:

```bash
npm run public:check
```

## Pull requests

Explica el problema, la solución, cómo lo verificaste y qué riesgo queda. Para cambios visuales incluye una comparación, pero utiliza únicamente recursos que puedan publicarse legalmente. No cambies versiones ni configuración de release salvo que el cambio forme parte explícita de la propuesta.
