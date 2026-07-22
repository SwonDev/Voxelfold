# Identidad de Voxelfold

## Idea central

Voxelfold convierte una construcción voxel en un plano que se puede comprender y ejecutar. Su símbolo muestra dos planos arquitectónicos plegados formando una V isométrica, unidos por una pieza dorada. La imagen comunica construcción, precisión y transformación sin depender de la marca de Hytale.

## Archivos maestros

- `assets/brand/voxelfold-icon-master.png`: máster RGB de 1254 × 1254 px.
- `public/brand/voxelfold-icon.png`: recurso utilizado por la interfaz y la documentación pública.
- `src-tauri/icons/`: derivados generados por Tauri para cada plataforma.

Los derivados se regeneran con:

```bash
npm run tauri -- icon public/brand/voxelfold-icon.png
```

## Uso

- Mantener una zona libre mínima equivalente a un octavo del ancho del símbolo.
- Utilizar el archivo completo sobre fondos oscuros o neutros.
- Para tamaños inferiores a 32 px, preferir los derivados nativos ya optimizados.
- Acompañar el símbolo con el nombre «Voxelfold» en Lexend cuando exista espacio.
- Describirlo como «Icono de Voxelfold: dos planos voxel plegados en forma de V» en texto alternativo.

## Usos prohibidos

- No deformar, rotar, espejar ni aplicar una máscara distinta.
- No sustituir la clave dorada por una gema o por el logotipo de otra marca.
- No superponer texturas, modelos, iconos o marcas de Hytale.
- No usar el símbolo verde anterior ni mezclar ambas identidades.
- No añadir firmas, atribuciones de asistentes, marcas de agua o texto generado dentro de la imagen.

## Paleta y voz

La marca utiliza azul noche, pizarra, cian mineral apagado, pergamino y oro. Los tokens exactos y las reglas de contraste están en `DESIGN.md`.

La voz es precisa, serena y útil. Habla como una herramienta de taller: explica qué ocurre, qué puede hacer el usuario y cómo recuperarse. Evita hipérboles, jerga de marketing, emojis y referencias a procesos internos de generación.

## Relación con Hytale

Voxelfold es una herramienta independiente y no oficial. Los recursos de Hytale se obtienen exclusivamente de la instalación o fuente autorizada del usuario y no forman parte del repositorio ni de la identidad pública de Voxelfold. Las páginas públicas deben conservar el aviso de no afiliación y evitar cualquier apariencia de producto oficial.
