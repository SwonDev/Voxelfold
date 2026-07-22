import * as THREE from "three";

/**
 * Configuración común para las texturas voxel de Hytale.
 *
 * De cerca conservamos el píxel nítido con `NearestFilter`. A distancia usamos
 * mipmaps trilineales y anisotropía para evitar los saltos bruscos de nivel que
 * hacían centellear tejados, follaje y bloques al mover la cámara.
 */
export function configurePixelTexture(texture: THREE.Texture): THREE.Texture {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  // TextureLoader marca `needsUpdate` cuando ya existe la imagen. Hacerlo aquí sobre el
  // placeholder vacío fuerza uploads fallidos y genera un warning por frame mientras carga.
  return texture;
}

const textureCache = new Map<string, THREE.Texture>();

/**
 * Devuelve inmediatamente la textura (aunque siga cargando) y comparte una sola
 * petición/instancia por URL. Three actualiza el mismo objeto al terminar, por lo
 * que no hace falta lanzar una segunda carga para forzar un render.
 */
export function loadPixelTexture(url: string | null): THREE.Texture | null {
  if (!url) return null;
  const cached = textureCache.get(url);
  if (cached) return cached;

  let texture: THREE.Texture;
  texture = new THREE.TextureLoader().load(
    url,
    undefined,
    undefined,
    () => {
      // Un fallo transitorio no debe envenenar el caché durante toda la sesión.
      if (textureCache.get(url) === texture) textureCache.delete(url);
    },
  );
  configurePixelTexture(texture);
  textureCache.set(url, texture);
  return texture;
}
