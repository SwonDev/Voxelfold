<p align="center">
  <img src="public/brand/voxelfold-icon.png" width="168" height="168" alt="Icono de Voxelfold: dos planos voxel plegados en forma de V">
</p>

<h1 align="center">Voxelfold</h1>

<p align="center"><strong>El taller definitivo para estudiar, editar y construir en Hytale.</strong></p>

<p align="center">
  <a href="https://github.com/SwonDev/Voxelfold/actions/workflows/ci.yml"><img alt="Calidad" src="https://img.shields.io/github/actions/workflow/status/SwonDev/Voxelfold/ci.yml?branch=main&amp;style=flat-square&amp;label=calidad"></a>
  <img alt="Versión" src="https://img.shields.io/badge/versi%C3%B3n-0.2.0-5a7da8?style=flat-square">
  <img alt="Plataforma" src="https://img.shields.io/badge/plataforma-macOS-26384a?style=flat-square">
  <img alt="Tecnología" src="https://img.shields.io/badge/Tauri-Rust%20%2B%20React-e0a64b?style=flat-square">
</p>

Voxelfold transforma construcciones de Hytale en guías visuales precisas. Permite inspeccionar cada bloque, editar en tres dimensiones, separar el modelo por capas, calcular materiales y avanzar paso a paso sin convertir la experiencia en un simple «pegar prefab».

La aplicación utiliza los recursos oficiales que el propio usuario tiene autorizados en su instalación local. El repositorio, los commits y los instaladores no redistribuyen texturas, modelos, iconos ni archivos de Hytale.

## Qué ofrece

- Biblioteca local de construcciones con categorías, dificultad, favoritos, fases y progreso.
- Importación de prefabs y catálogo dinámico de bloques desde la instalación de Hytale.
- Editor 3D de precisión con colocar, pintar, borrar, reemplazar, línea, caja, relleno, brocha, selección, copiar y pegar.
- Orientación inteligente, rotaciones completas, piezas multicelda y geometría oficial de bloques complejos.
- Vista por capas, medidas, coordenadas, recuentos y lista exacta de materiales.
- Representación fiel de texturas por cara, variantes, modelos, transparencias, emisivos, vegetación y animaciones.
- Entornos de previsualización por bioma, luz ambiental, sombras, oclusión y bloom.
- Guardado transaccional, deshacer y rehacer, recuperación de sesiones y estados de error claros.
- Actualización firmada de Voxelfold y comprobación continua de compatibilidad con Hytale Shared Source.

## Editor fluido por diseño

El render agrupa bloques equivalentes en mallas instanciadas, calcula iluminación y geometría suave en un Web Worker y limita las actualizaciones de puntero a un fotograma. La resolución se adapta a la carga de la GPU antes de reducir efectos visuales; AO, bloom, sombras y animación se mantienen activos siempre que el equipo pueda sostenerlos.

El panel opcional «Rendimiento» muestra FPS, draw calls, triángulos, DPR y tiempo de horneado fuera del hilo. Esto permite detectar regresiones en construcciones reales, no solo en escenas sintéticas.

## Recursos oficiales sin redistribución

Voxelfold sigue un modelo bring-your-own-assets:

1. Detecta los canales y ubicaciones compatibles de la instalación local.
2. Indexa automáticamente bloques, modelos, texturas, iconos, animaciones y datos de prefabs.
3. Sirve esos archivos a la interfaz mediante el protocolo local `voxelfold-asset://`.
4. Conserva la última revisión válida si una actualización llega incompleta.
5. Compara periódicamente el contrato compatible con `SwonDev/hytale-shared-source` mediante CI privada.

El contrato y las reglas de compatibilidad se documentan en [HYTALE_COMPATIBILITY.md](docs/HYTALE_COMPATIBILITY.md).

## Arquitectura

| Área | Implementación |
|---|---|
| Aplicación de escritorio | Tauri 2 |
| Núcleo y acceso local | Rust |
| Persistencia | SQLite |
| Interfaz | React 19 y TypeScript estricto |
| Render 3D | Three.js y React Three Fiber |
| Procesamiento pesado | Web Workers y buffers transferibles |
| Actualizaciones | Tauri Updater con manifiestos firmados |

La interfaz no recibe acceso directo al sistema de archivos. Las operaciones sensibles pasan por comandos Rust tipados y capacidades Tauri explícitas.

## Desarrollo

### Requisitos

- macOS con Xcode Command Line Tools.
- Node.js 20.19 o superior.
- Rust estable.
- Una instalación autorizada de Hytale para validar sus recursos en tiempo de ejecución.

### Preparación

```bash
git clone https://github.com/SwonDev/Voxelfold.git
cd Voxelfold
npm ci
npm run tauri -- dev
```

La compilación de distribución se crea con:

```bash
npm run tauri -- build
```

Las claves de firma y los recursos de Hytale deben permanecer fuera del repositorio. Consulta [RELEASING.md](docs/RELEASING.md) para el flujo de firma, notarización y publicación.

## Puertas de calidad

```bash
npm run public:check
npm run source:check
npm run release:check
npm run test:frontend
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
npx @google/design.md lint DESIGN.md
```

`public:check` impide publicar secretos, rutas personales, correos, recursos oficiales, archivos de firma, artefactos de prueba o atribuciones automáticas. La misma puerta se ejecuta en CI.

## Contribuir

Lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir una propuesta. Los informes deben incluir pasos reproducibles y datos técnicos, pero nunca adjuntar archivos, capturas privadas o recursos extraídos de Hytale.

Los problemas de seguridad se comunican mediante el sistema privado de avisos de seguridad de GitHub siguiendo [SECURITY.md](SECURITY.md).

## Identidad

La marca, su símbolo y sus reglas de uso están en [BRAND.md](docs/BRAND.md). El sistema visual completo se define en [DESIGN.md](DESIGN.md). Ningún recurso oficial de Hytale forma parte del logotipo de Voxelfold.

## Aviso legal

Voxelfold es una herramienta no oficial creada para la comunidad de constructores de Hytale. No está afiliada, respaldada ni conectada con Hypixel Studios. Hytale y sus marcas relacionadas pertenecen a sus respectivos titulares.

El acceso al código fuente de Voxelfold no concede derechos sobre recursos de Hytale ni sobre repositorios de acceso restringido. Cada usuario y colaborador es responsable de utilizar únicamente material para el que disponga de autorización.
