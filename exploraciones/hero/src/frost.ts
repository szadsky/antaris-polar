import * as THREE from 'three';

/**
 * Transición del hero al hacer scroll: una máscara que lo va cubriendo desde los bordes hacia el centro y termina en el
 * color de fondo de la sección de abajo, así no hay corte entre el hero y lo que sigue.
 *
 * Sin geometría visible (pedido del usuario): nada de malla, triángulos, celdas, líneas ni partículas. El borde es
 * orgánico (ruido suave, lento) y ancho; en la franja de transición la imagen se esmerila (desenfoque leve y un tinte
 * frío, como escarcha) antes de fundirse en el color de la sección.
 *
 * Cómo: la escena se dibuja a pantalla como siempre; si hay progreso, ese cuadro final (ya con tone mapping y en sRGB) se
 * copia a una textura y encima se dibuja un triángulo de pantalla completa con la máscara, en el mismo espacio de color
 * de la imagen y del CSS. Con progreso 0 no se hace nada (costo cero en reposo).
 */
export interface Frost {
  /** progress: 0 (nada) … 1 (hero cubierto por el color de la sección). time en segundos (0 = borde quieto). */
  render(progress: number, time: number): void;
  /** Color final de la máscara, en sRGB 0…1 (el fondo de la sección siguiente). */
  setColor(r: number, g: number, b: number): void;
  /** Distancia normalizada del frente sin ruido (1 = bordes, 0 = centro): para apagar los textos que va cubriendo. */
  edgeAt(progress: number): number;
  dispose(): void;
}

/** Alcance del frente por unidad de progreso: con 1 la franja de transición entera ya pasó el centro. */
const REACH = 1.35;
/** Ancho de la franja de transición (unidades de la distancia normalizada, 1 = del borde al centro). */
const FEATHER = 0.22;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uRes;
  uniform vec3 uBg;
  uniform float uP, uTime;
  varying vec2 vUv;

  const vec3 FROST = vec3(0.90, 0.945, 0.97); // tinte frío de la franja (sRGB)

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { return noise(p) * 0.6 + noise(p * 2.03 + 17.1) * 0.28 + noise(p * 4.1 + 3.7) * 0.12; }

  void main() {
    vec2 uv = vUv;
    float asp = uRes.x / uRes.y;
    vec2 q = uv * 2.0 - 1.0;
    float s = pow(pow(abs(q.x), 6.0) + pow(abs(q.y), 6.0), 1.0 / 6.0); // rectángulo redondeado: 1 en los bordes
    vec2 qa = q * vec2(asp, 1.0);
    float reach = uP * ${REACH.toFixed(2)};
    // Borde orgánico: ruido de baja frecuencia, que crece al empezar y se calma al final (sin huecos con progreso 1).
    float amp = min(reach * 2.5, 1.0) * (1.0 - 0.8 * smoothstep(0.7, 1.0, uP));
    float wob = fbm(qa * 1.3 + vec2(uTime * 0.05, -uTime * 0.04)) - 0.5;
    float edge = 1.0 - reach + wob * 0.32 * amp;
    float d = s - edge;                                  // > 0: adentro de la máscara
    if (d < -0.02) { gl_FragColor = vec4(0.0); return; } // todavía sin tocar

    float m = smoothstep(-0.02, ${FEATHER.toFixed(2)}, d); // 0 → imagen, 1 → color de la sección
    if (m > 0.995) { gl_FragColor = vec4(uBg, 1.0); return; }

    // Franja de transición: imagen esmerilada (desenfoque leve) con un tinte frío que se funde en el color final.
    float rad = mix(1.5, 9.0, m) / uRes.y;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float a = fi * 2.39996, rr = sqrt((fi + 0.5) / 8.0);
      acc += texture2D(tScene, uv + vec2(cos(a) / asp, sin(a)) * rr * rad).rgb;
    }
    vec3 img = acc / 8.0;
    float band = smoothstep(0.0, 0.35, m) * (1.0 - smoothstep(0.55, 1.0, m)); // escarcha solo en la franja
    vec3 col = mix(img, FROST, 0.35 * band);
    col = mix(col, uBg, smoothstep(0.25, 1.0, m));
    gl_FragColor = vec4(col * m, m);                     // premultiplicado: m cubre la imagen
  }
`;

export function createFrost(renderer: THREE.WebGLRenderer): Frost {
  let tex = new THREE.FramebufferTexture(1, 1);
  const uniforms = {
    tScene: { value: tex as THREE.Texture },
    uRes: { value: new THREE.Vector2(1, 1) },
    uBg: { value: new THREE.Vector3(0.957, 0.969, 0.984) }, // #f4f7fb hasta que se lea el de la página
    uP: { value: 0 },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const tri = new THREE.Mesh(geo, material);
  tri.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(tri);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2();

  return {
    edgeAt: (p) => 1 - p * REACH,
    setColor: (r, g, b) => { uniforms.uBg.value.set(r, g, b); },
    render(progress, time) {
      if (progress <= 0.0005) return;
      renderer.getDrawingBufferSize(size);
      if (tex.image.width !== size.x || tex.image.height !== size.y) {
        tex.dispose();
        tex = new THREE.FramebufferTexture(size.x, size.y);
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        uniforms.tScene.value = tex;
        uniforms.uRes.value.copy(size);
      }
      renderer.copyFramebufferToTexture(tex);
      uniforms.uP.value = progress;
      uniforms.uTime.value = time;
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, cam);
      renderer.autoClear = autoClear;
    },
    dispose() { tex.dispose(); geo.dispose(); material.dispose(); },
  };
}
