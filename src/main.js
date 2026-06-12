// NEON RUSH — 3-stage 3D runner
// 見栄え実験: シェーダー空 + グリッド + テーマ別ボール/壁/装飾 + bloom/CA/vignette
// タイトル → ステージ選択(ネオン街/砂浜/ジャングル) → プレイ

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { initAudio, resumeAudio, loadBgm, startBgm, duckBgm, sfx } from './audio.js';

initAudio();
loadBgm(`${import.meta.env.BASE_URL}bgm.mp3`);
let audioStarted = false;
function startAudioOnce() {
  resumeAudio();
  if (audioStarted) return;
  audioStarted = true;
  startBgm();
}

// ---------------------------------------------------------------- constants
const LANES = [-2.2, 0, 2.2];
const BALL_R = 0.55;
const WORLD_DEPTH = 240;
const SPAWN_Z = -195;
const GOAL_DIST = 2000; // この距離を走り切るとステージクリア
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// ---------------------------------------------------------------- themes
// 各ステージの世界観を1オブジェクトに集約。色は raw な vec3（Vector3）でシェーダーに渡す
const THEMES = {
  neon: {
    label: 'ネオン街', fog: 0x16042e, fogNear: 35, fogFar: 230,
    sky: {
      top: [0.045, 0.0, 0.14], mid: [0.30, 0.04, 0.46], horizon: [0.85, 0.20, 0.42],
      sunA: [1.0, 0.22, 0.55], sunB: [1.0, 0.88, 0.35], glow: [1.0, 0.38, 0.5],
      sunSize: 0.22, stripes: 1, stars: 1,
    },
    ground: [0.02, 0.005, 0.05], gridColor: [1.0, 0.16, 0.78], gridIntensity: 1.05,
    runway: { base: [0.035, 0.025, 0.075], lane: [0.2, 0.95, 1.0], edge: [0.85, 0.1, 0.65] },
    rails: [0x18e7ff, 0xff2bd6], glowHex: 0xff5fd0,
    light: { hemiSky: 0x6040c0, hemiGround: 0x180430, key: 0xff70b8, point: 0xff4fd8 },
    decor: 'city', wheel: true, ball: 'disco', obstacle: 'neon',
  },
  beach: {
    // 空の広い面はブルーム閾値(0.82)以下に抑え、太陽の円盤だけ光らせる
    label: '砂浜', fog: 0x6f9fb8, fogNear: 40, fogFar: 260,
    sky: {
      top: [0.20, 0.42, 0.72], mid: [0.34, 0.56, 0.78], horizon: [0.52, 0.68, 0.80],
      sunA: [1.0, 0.95, 0.75], sunB: [1.0, 1.0, 0.92], glow: [0.9, 0.85, 0.6],
      sunSize: 0.10, stripes: 0, stars: 0,
    },
    ground: [0.42, 0.37, 0.22], gridColor: [0.7, 0.66, 0.5], gridIntensity: 0.12,
    runway: { base: [0.46, 0.40, 0.24], lane: [0.92, 0.92, 0.9], edge: [0.2, 0.55, 0.78] },
    rails: [0xff7a5c, 0x29b6e6], glowHex: 0xffe0a0,
    light: { hemiSky: 0xbfe6ff, hemiGround: 0xe6d2a0, key: 0xfff4d6, point: 0xffe6b0 },
    decor: 'palm', wheel: false, ball: 'beach', obstacle: 'beach',
  },
  jungle: {
    label: 'ジャングル', fog: 0x0c2410, fogNear: 22, fogFar: 150,
    sky: {
      top: [0.02, 0.09, 0.04], mid: [0.05, 0.18, 0.09], horizon: [0.22, 0.34, 0.16],
      sunA: [0.7, 0.78, 0.4], sunB: [0.9, 0.92, 0.65], glow: [0.45, 0.55, 0.3],
      sunSize: 0.06, stripes: 0, stars: 0,
    },
    ground: [0.04, 0.09, 0.035], gridColor: [0.25, 0.45, 0.18], gridIntensity: 0.18,
    runway: { base: [0.10, 0.12, 0.06], lane: [0.45, 0.4, 0.25], edge: [0.12, 0.25, 0.10] },
    rails: [0x7a5a30, 0x4f7a2a], glowHex: 0x86e060,
    light: { hemiSky: 0x4a7a40, hemiGround: 0x0c1808, key: 0xbcd488, point: 0xa8e070 },
    decor: 'tree', wheel: false, ball: 'boulder', obstacle: 'jungle',
  },
};
const THEME_KEYS = ['neon', 'beach', 'jungle'];

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(THEMES.neon.fog, THEMES.neon.fogNear, THEMES.neon.fogFar);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 900);
camera.position.set(0, 3.1, 6.2);

// ---------------------------------------------------------------- sky (shader dome)
const skyUniforms = {
  uTime: { value: 0 },
  uTop: { value: v3(THEMES.neon.sky.top) },
  uMid: { value: v3(THEMES.neon.sky.mid) },
  uHorizon: { value: v3(THEMES.neon.sky.horizon) },
  uSunA: { value: v3(THEMES.neon.sky.sunA) },
  uSunB: { value: v3(THEMES.neon.sky.sunB) },
  uGlow: { value: v3(THEMES.neon.sky.glow) },
  uSunSize: { value: THEMES.neon.sky.sunSize },
  uStripes: { value: THEMES.neon.sky.stripes },
  uStars: { value: THEMES.neon.sky.stars },
};
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: skyUniforms,
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform vec3 uTop, uMid, uHorizon, uSunA, uSunB, uGlow;
    uniform float uSunSize, uStripes, uStars;
    varying vec3 vDir;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec3 dir = normalize(vDir);
      float h = dir.y;

      vec3 col = mix(uMid, uTop, smoothstep(0.08, 0.65, h));
      col = mix(uHorizon, col, smoothstep(-0.02, 0.22, h));

      // sun (synthwave stripes toggle)
      vec3 sunDir = normalize(vec3(0.0, 0.085, -1.0));
      float ang = acos(clamp(dot(dir, sunDir), -1.0, 1.0));
      float R = uSunSize;
      float disc = 1.0 - smoothstep(R * 0.97, R, ang);
      float sy = clamp((dir.y - (sunDir.y - R)) / (2.0 * R), 0.0, 1.0);
      float stripeF = step(mix(0.78, 0.0, smoothstep(0.0, 0.75, sy)), fract(sy * 7.0 - uTime * 0.1));
      float stripes = mix(1.0, stripeF, uStripes);
      vec3 sunCol = mix(uSunA, uSunB, sy);
      col += disc * stripes * sunCol * 1.7;

      // glow + horizon haze
      col += pow(max(dot(dir, sunDir), 0.0), 24.0) * uGlow * 0.3;
      col += smoothstep(0.22, 0.0, abs(h)) * uHorizon * 0.22;

      // stars (toggle)
      vec2 sc = vec2(atan(dir.x, dir.z) * 42.0, dir.y * 85.0);
      vec2 cell = floor(sc);
      vec2 f = fract(sc) - 0.5;
      float rnd = hash(cell);
      float star = step(0.93, rnd) * smoothstep(0.22, 0.0, length(f))
                 * (0.55 + 0.45 * sin(uTime * 2.5 + rnd * 50.0));
      col += uStars * star * vec3(0.85, 0.9, 1.0) * smoothstep(0.10, 0.32, h);

      gl_FragColor = vec4(col, 1.0);
    }`,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(420, 40, 24), skyMat);
scene.add(skyDome);

// 空をキューブマップに焼いてディスコボールの反射に使う（neon を1回だけベイク）
const cubeRT = new THREE.WebGLCubeRenderTarget(128, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
const cubeCam = new THREE.CubeCamera(0.5, 900, cubeRT);
{
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(skyDome.geometry, skyMat));
  cubeCam.position.set(0, 2, 0);
  cubeCam.update(renderer, envScene);
}
scene.environment = cubeRT.texture;

// ---------------------------------------------------------------- grid floor
const gridMat = new THREE.ShaderMaterial({
  uniforms: {
    uScroll: { value: 0 },
    uFog: { value: new THREE.Color(THEMES.neon.fog) },
    uGround: { value: v3(THEMES.neon.ground) },
    uGridColor: { value: v3(THEMES.neon.gridColor) },
    uGridIntensity: { value: THEMES.neon.gridIntensity },
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uScroll, uGridIntensity;
    uniform vec3 uFog, uGround, uGridColor;
    varying vec3 vWorld;
    void main() {
      vec2 g = vec2(vWorld.x, vWorld.z + uScroll) / 4.0;
      vec2 q = abs(fract(g) - 0.5);
      float d = min(q.x, q.y) * 4.0;
      float fade = 1.0 - smoothstep(30.0, 180.0, length(vWorld.xz));
      vec3 col = uGround;
      col += (1.0 - smoothstep(0.0, 0.10, d)) * uGridColor * 1.05 * uGridIntensity * fade;
      col += (1.0 - smoothstep(0.0, 0.9, d)) * uGridColor * 0.3 * uGridIntensity * fade;
      col = mix(uFog, col, fade * 0.85 + 0.15);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), gridMat);
gridPlane.rotation.x = -Math.PI / 2;
scene.add(gridPlane);

// ---------------------------------------------------------------- runway
const runwayMat = new THREE.ShaderMaterial({
  uniforms: {
    uScroll: gridMat.uniforms.uScroll,
    uFog: { value: new THREE.Color(THEMES.neon.fog) },
    uBase: { value: v3(THEMES.neon.runway.base) },
    uLane: { value: v3(THEMES.neon.runway.lane) },
    uEdge: { value: v3(THEMES.neon.runway.edge) },
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uScroll;
    uniform vec3 uFog, uBase, uLane, uEdge;
    varying vec3 vWorld;
    void main() {
      float z = vWorld.z + uScroll;
      float fade = 1.0 - smoothstep(40.0, 200.0, -vWorld.z);
      vec3 col = uBase;
      float lane = 1.0 - smoothstep(0.03, 0.07, abs(abs(vWorld.x) - 1.1));
      float dash = step(0.45, fract(z / 4.0));
      col += lane * dash * uLane * 1.3 * fade;
      float edge = smoothstep(2.6, 3.35, abs(vWorld.x));
      col += edge * uEdge * 0.8 * fade;
      float pulse = smoothstep(0.92, 1.0, fract(z / 24.0));
      col += pulse * (1.0 - smoothstep(0.0, 2.4, abs(vWorld.x))) * uEdge * 0.5 * fade;
      col = mix(uFog, col, fade * 0.9 + 0.1);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const runway = new THREE.Mesh(new THREE.PlaneGeometry(6.9, 500), runwayMat);
runway.rotation.x = -Math.PI / 2;
runway.position.y = 0.02;
runway.position.z = -180;
scene.add(runway);

// edge rails
const railGeo = new THREE.BoxGeometry(0.12, 0.12, 500);
const railL = new THREE.Mesh(railGeo, new THREE.MeshBasicMaterial());
railL.position.set(-3.5, 0.1, -180);
const railR = new THREE.Mesh(railGeo, new THREE.MeshBasicMaterial());
railR.position.set(3.5, 0.1, -180);
scene.add(railL, railR);

// ---------------------------------------------------------------- decor (city / palm / tree)
function makeWindowTexture() {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 192;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0418';
  ctx.fillRect(0, 0, c.width, c.height);
  const palette = ['#7df9ff', '#ff71ce', '#ffd319', '#b967ff', '#fffae0'];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 6; x++) {
      if (Math.random() < 0.38) {
        ctx.fillStyle = palette[(Math.random() * palette.length) | 0];
        ctx.globalAlpha = 0.55 + Math.random() * 0.45;
        ctx.fillRect(x * 16 + 4, y * 12 + 3, 8, 6);
      }
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const roofMat = new THREE.MeshBasicMaterial({ color: 0x070312, fog: true });
const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
function makeBuilding() {
  const w = 4 + Math.random() * 7, hgt = 7 + Math.random() * 26, dep = 4 + Math.random() * 6;
  const tex = makeWindowTexture();
  tex.repeat.set(Math.max(1, Math.round(w / 5)), Math.max(1, Math.round(hgt / 9)));
  const sideMat = new THREE.MeshBasicMaterial({ map: tex, fog: true, color: new THREE.Color(1.5, 1.5, 1.5) });
  const mesh = new THREE.Mesh(buildingGeo, [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat]);
  mesh.scale.set(w, hgt, dep);
  mesh.position.y = hgt / 2;
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}
function makePalm() {
  const g = new THREE.Group();
  const h = 4 + Math.random() * 3;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.38, h, 7),
    new THREE.MeshStandardMaterial({ color: 0x7a5328, roughness: 0.9, fog: true }),
  );
  trunk.position.y = h / 2;
  trunk.rotation.z = (Math.random() - 0.5) * 0.25;
  g.add(trunk);
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x2f9e44, roughness: 0.7, side: THREE.DoubleSide, fog: true });
  for (let i = 0; i < 7; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.32, 2.6, 4), frondMat);
    const a = (i / 7) * Math.PI * 2;
    f.rotation.order = 'YXZ';
    f.rotation.y = a;
    f.rotation.x = Math.PI * 0.62; // 外向きに倒して垂れさせる
    f.position.set(Math.cos(a) * 0.6, h, Math.sin(a) * 0.6);
    f.scale.set(1, 1, 0.35);
    g.add(f);
  }
  return g;
}
function makeTree() {
  const g = new THREE.Group();
  const h = 3 + Math.random() * 4;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.5, h, 7),
    new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.95, fog: true }),
  );
  trunk.position.y = h / 2;
  g.add(trunk);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x256d2a, roughness: 0.9, flatShading: true, fog: true });
  for (let i = 0; i < 4; i++) {
    const r = 1.2 + Math.random() * 0.8;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMat);
    b.position.set((Math.random() - 0.5) * 1.6, h + Math.random() * 1.6, (Math.random() - 0.5) * 1.6);
    g.add(b);
  }
  return g;
}
let decor = [];
function buildDecor(key) {
  for (const g of decor) scene.remove(g);
  decor = [];
  const maker = key === 'palm' ? makePalm : key === 'tree' ? makeTree : makeBuilding;
  const n = key === 'city' ? 44 : 30;
  for (let i = 0; i < n; i++) {
    const g = maker();
    const side = i % 2 === 0 ? -1 : 1;
    g.position.set(side * (9 + Math.random() * 26), 0, -Math.random() * WORLD_DEPTH);
    scene.add(g);
    decor.push(g);
  }
}

// ---------------------------------------------------------------- ferris wheel (neon遠景)
const wheel = new THREE.Group();
{
  const rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff49c1).multiplyScalar(2.0), fog: true });
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(17, 0.35, 8, 64), rimMat));
  const spokeMat = new THREE.MeshBasicMaterial({ color: 0x9a3bff, fog: true });
  for (let i = 0; i < 8; i++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 34, 6), spokeMat);
    spoke.rotation.z = (i / 8) * Math.PI;
    wheel.add(spoke);
  }
  const carMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35f0ff).multiplyScalar(2.2), fog: true });
  for (let i = 0; i < 12; i++) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), carMat);
    const a = (i / 12) * Math.PI * 2;
    car.position.set(Math.cos(a) * 17, Math.sin(a) * 17, 0);
    wheel.add(car);
  }
  wheel.position.set(26, 18.5, -205);
  scene.add(wheel);
}

// ---------------------------------------------------------------- player ball
const ball = new THREE.Group();      // 回転専用
const ballPivot = new THREE.Group(); // 横移動・ジャンプ
ballPivot.add(ball);
ballPivot.position.set(0, BALL_R, 0);
scene.add(ballPivot);

function buildDisco() {
  ball.add(new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R * 0.93, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a0a22, metalness: 0.8, roughness: 0.4 }),
  ));
  const src = new THREE.SphereGeometry(1, 26, 18);
  const pos = src.attributes.position;
  const seen = new Set();
  const normals = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normals.push(v.clone().normalize());
  }
  const tileMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 1.0, roughness: 0.12,
    envMap: cubeRT.texture, envMapIntensity: 1.6,
  });
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.155, 0.155, 0.04), tileMat, normals.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  normals.forEach((n, i) => {
    q.setFromUnitVectors(zAxis, n);
    m.compose(n.clone().multiplyScalar(BALL_R * 0.96), q, new THREE.Vector3(1, 1, 1));
    tiles.setMatrixAt(i, m);
  });
  ball.add(tiles);
}
function makeBeachTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  const cols = ['#ff4655', '#ffd23f', '#ffffff', '#3fa9ff', '#46d36b', '#ff8f3f'];
  const bw = c.width / cols.length;
  cols.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(i * bw, 0, bw + 1, c.height); });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, 22);
  ctx.fillRect(0, c.height - 22, c.width, 22);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function buildBeachBall() {
  ball.add(new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 32, 24),
    new THREE.MeshStandardMaterial({
      map: makeBeachTexture(), roughness: 0.3, metalness: 0.0,
      envMap: cubeRT.texture, envMapIntensity: 0.25,
    }),
  ));
}
function buildBoulder() {
  const geo = new THREE.IcosahedronGeometry(BALL_R, 3);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const n = 0.12 * Math.sin(v.x * 9) * Math.sin(v.y * 9 + 1.3) * Math.sin(v.z * 9 + 2.1);
    v.multiplyScalar(1 + n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  ball.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x6b6358, roughness: 1.0, flatShading: true })));
}
function buildBall(kind) {
  ball.clear();
  if (kind === 'beach') buildBeachBall();
  else if (kind === 'boulder') buildBoulder();
  else buildDisco();
}

// glow sprite（白マップをテーマ色で着色）
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const glow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false,
}));
glow.scale.set(2.3, 2.3, 1);
scene.add(glow);

// ---------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(0x6040c0, 0x180430, 0.7);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xff70b8, 1.4);
keyLight.position.set(-4, 8, 6);
scene.add(keyLight);
const ballLight = new THREE.PointLight(0xff4fd8, 18, 14, 2);
scene.add(ballLight);

// ---------------------------------------------------------------- obstacles
// ネオン街: 工事現場のコーン＋バー / オレンジのバリケード
function makeBarrierTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ff6a00';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#fff4e6';
  ctx.lineWidth = 24;
  for (let x = -160; x < 384; x += 72) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 128, 128); ctx.stroke();
  }
  ctx.strokeStyle = '#140a00';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 120);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const barrierTex = makeBarrierTexture();
const coneOrange = () => new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.5, fog: true });
function makeCone(x) {
  const g = new THREE.Group();
  const orange = coneOrange();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.78, 16), orange); cone.position.y = 0.42;
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(0.205, 0.24, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, fog: true }),
  );
  ring.position.y = 0.36;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.5), orange); base.position.y = 0.035;
  g.add(cone, ring, base);
  g.position.x = x;
  return g;
}
function obConeBar() {
  const out = [makeCone(-0.7), makeCone(0.7)];
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.2, 0.08),
    new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.5, fog: true }),
  );
  bar.position.set(0, 0.78, 0);
  out.push(bar);
  return out;
}
function obBarrier() {
  const out = [];
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.85, 0.85, 0.12),
    new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.55, fog: true }),
  );
  panel.position.y = 0.62;
  out.push(panel);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7, fog: true });
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.05, 0.55), legMat);
    leg.position.set(s * 0.82, 0.5, 0);
    out.push(leg);
  }
  return out;
}
function obNeon() {
  return Math.random() < 0.5 ? obConeBar() : obBarrier();
}
function obParasol() {
  const out = [];
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.95, 8),
    new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6, fog: true }),
  );
  pole.position.y = 0.47;
  out.push(pole);
  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(0.95, 0.5, 12),
    new THREE.MeshStandardMaterial({ color: 0xff4d5e, roughness: 0.5, fog: true }),
  );
  canopy.position.y = 0.95;
  out.push(canopy);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, fog: true }));
  tip.position.y = 1.2;
  out.push(tip);
  return out;
}
function obCrab() {
  const out = [];
  const red = () => new THREE.MeshStandardMaterial({ color: 0xff5a3c, roughness: 0.5, fog: true });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), red());
  body.scale.set(1.5, 0.7, 1.1); body.position.y = 0.45;
  out.push(body);
  for (const s of [-1, 1]) {
    const claw = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), red());
    claw.scale.set(1.5, 0.9, 0.9); claw.position.set(s * 0.9, 0.4, 0.35);
    out.push(claw);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6), red());
    stalk.position.set(s * 0.18, 0.8, 0.15);
    out.push(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshStandardMaterial({ color: 0x111111, fog: true }));
    eye.position.set(s * 0.18, 0.98, 0.15);
    out.push(eye);
  }
  return out;
}
function obRock() {
  const geo = new THREE.IcosahedronGeometry(0.7, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const n = 0.2 * Math.sin(v.x * 7 + 1.0) * Math.sin(v.y * 7 + 0.5) * Math.sin(v.z * 7 + 2.0);
    v.multiplyScalar(1 + n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7c756b, roughness: 1.0, flatShading: true, fog: true }));
  m.scale.set(1.3, 0.95, 1.05); m.position.y = 0.58;
  return [m];
}
function obBush() {
  const out = [];
  const mat = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.9, flatShading: true, fog: true });
  const blobs = [[0, 0.5, 0, 0.6], [-0.5, 0.42, 0.1, 0.46], [0.5, 0.44, -0.1, 0.5], [0, 0.85, 0, 0.42], [0.15, 0.55, 0.45, 0.38]];
  for (const [x, y, z, r] of blobs) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat);
    b.position.set(x, y, z);
    out.push(b);
  }
  return out;
}
const obstacles = [];
for (let i = 0; i < 14; i++) {
  const grp = new THREE.Group();
  grp.visible = false;
  scene.add(grp);
  obstacles.push({ mesh: grp, active: false, lane: 0 });
}
function applyObstacleTheme(key) {
  for (const o of obstacles) {
    o.mesh.clear();
    let parts;
    if (key === 'beach') parts = Math.random() < 0.5 ? obParasol() : obCrab();
    else if (key === 'jungle') parts = Math.random() < 0.5 ? obRock() : obBush();
    else parts = obNeon();
    for (const m of parts) o.mesh.add(m);
  }
}

// ---------------------------------------------------------------- rings
const ringGeo = new THREE.TorusGeometry(0.95, 0.085, 10, 40);
const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc928).multiplyScalar(2.4), fog: true });
const rings = [];
for (let i = 0; i < 12; i++) {
  const mesh = new THREE.Mesh(ringGeo, ringMat);
  mesh.visible = false;
  scene.add(mesh);
  rings.push({ mesh, active: false, lane: 0, air: false });
}

// ---------------------------------------------------------------- goal gate
let goalActive = false;
const goal = new THREE.Group();
{
  const topMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35f0ff).multiplyScalar(2.6), fog: true });
  const postMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2bd6).multiplyScalar(2.4), fog: true });
  const postGeo = new THREE.BoxGeometry(0.4, 6.2, 0.4);
  const pL = new THREE.Mesh(postGeo, postMat); pL.position.set(-3.5, 3.1, 0);
  const pR = new THREE.Mesh(postGeo, postMat); pR.position.set(3.5, 3.1, 0);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.55, 0.55), topMat); bar.position.set(0, 6.0, 0);
  goal.add(pL, pR, bar);
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0018'; ctx.fillRect(0, 0, 512, 128);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#f0f6ff' : '#1a0830';
      ctx.fillRect(x * 32, y === 0 ? 0 : 104, 32, 24);
    }
  }
  ctx.font = '900 italic 74px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffe23a'; ctx.fillText('GOAL', 256, 66);
  ctx.lineWidth = 3; ctx.strokeStyle = '#ff2bd6'; ctx.strokeText('GOAL', 256, 66);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 1.8),
    new THREE.MeshBasicMaterial({ map: tex, fog: true, transparent: true }),
  );
  banner.position.set(0, 4.9, 0.32);
  goal.add(banner);
}
goal.visible = false;
goal.position.z = SPAWN_Z;
scene.add(goal);

// ---------------------------------------------------------------- speed streaks
const streaks = (() => {
  const n = 260;
  const geo = new THREE.BufferGeometry();
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = (Math.random() - 0.5) * 30;
    arr[i * 3 + 1] = Math.random() * 9 + 0.3;
    arr[i * 3 + 2] = -Math.random() * 130;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xbfe8ff, size: 0.07, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(pts);
  return pts;
})();

// ---------------------------------------------------------------- post processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float ca = 0.0028 + dot(c, c) * 0.005;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ca).b;
      col *= 1.0 - 0.05 * sin(vUv.y * uRes.y * 1.6 + uTime * 8.0);  // scanline
      col *= 1.0 - 0.42 * smoothstep(0.32, 0.85, length(c));        // vignette
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(gradePass);

// ---------------------------------------------------------------- HUD
const $score = document.getElementById('score');
const $combo = document.getElementById('combo');
const $dist = document.getElementById('dist');
const $popups = document.getElementById('popups');
const $flash = document.getElementById('flash');
const $lives = document.getElementById('lives');
const $gameover = document.getElementById('gameover');
const $goTitle = document.getElementById('go-title');
const $goScore = document.getElementById('go-score');
const $goDist = document.getElementById('go-dist');
const $goBest = document.getElementById('go-best');
const $goRecord = document.getElementById('go-record');
const $title = document.getElementById('title');
const $select = document.getElementById('select');
const cards = [...document.querySelectorAll('.s-card')];
const $pausebtn = document.getElementById('pausebtn');
const pauseOpts = [...document.querySelectorAll('.p-opt')];

const projV = new THREE.Vector3();
function popup(text, worldPos) {
  projV.copy(worldPos).project(camera);
  const el = document.createElement('div');
  el.className = 'popup';
  el.textContent = text;
  el.style.left = `${(projV.x * 0.5 + 0.5) * innerWidth}px`;
  el.style.top = `${(-projV.y * 0.5 + 0.5) * innerHeight}px`;
  el.addEventListener('animationend', () => el.remove());
  $popups.appendChild(el);
}

// ---------------------------------------------------------------- game state
const state = {
  lane: 1, x: 0, jumpY: 0, vy: 0, grounded: true,
  speed: 17, distance: 0, score: 0, combo: 0,
  nextSpawn: 30, invincible: 0, shake: 0,
  demo: true, autoCool: 0,
  lives: 3, gameOver: false, cleared: false, overCool: 0,
  hitstop: 0, pendingGameOver: false,
};

let countRaf = 0;
function animateCount(el, target, ms) {
  cancelAnimationFrame(countRaf);
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
    el.textContent = Math.floor(target * e).toLocaleString('en-US');
    if (k < 1) countRaf = requestAnimationFrame(step);
  };
  countRaf = requestAnimationFrame(step);
}

function updateLives() {
  $lives.innerHTML = [0, 1, 2]
    .map((i) => `<span${i < state.lives ? '' : ' class="off"'}>♥</span>`)
    .join('');
}

const BEST_KEY = 'neonrush_best';
function doGameOver(cleared = false) {
  state.gameOver = true;
  state.cleared = cleared;
  state.overCool = 0.9;
  let final = Math.floor(state.score);
  if (cleared) final += 3000 + state.lives * 1000; // クリアボーナス
  const prevBest = Number(localStorage.getItem(BEST_KEY) || 0);
  const isRecord = final > prevBest;
  if (isRecord) localStorage.setItem(BEST_KEY, String(final));
  $goTitle.textContent = cleared ? 'STAGE CLEAR!' : 'GAME OVER';
  $goDist.textContent = `${Math.floor(state.distance)}m`;
  $goBest.textContent = `BEST ${Math.max(final, prevBest).toLocaleString('en-US')}`;
  $goRecord.classList.toggle('show', isRecord);
  $gameover.classList.toggle('clear', cleared);
  $gameover.classList.add('on');
  animateCount($goScore, final, 1100);
  if (cleared) sfx.clear(); else sfx.gameOver();
  duckBgm(cleared ? 0.3 : 0.12, 0.5);
}

function resetRun() {
  for (const o of obstacles) { o.active = false; o.mesh.visible = false; }
  for (const r of rings) { r.active = false; r.mesh.visible = false; }
  goalActive = false;
  goal.visible = false;
  goal.position.z = SPAWN_Z;
}

function restart() {
  // 同じステージで再挑戦（テーマは維持）
  resetRun();
  Object.assign(state, {
    lane: 1, jumpY: 0, vy: 0, grounded: true,
    speed: 17, distance: 0, score: 0, combo: 0,
    nextSpawn: 30, invincible: 1.2, shake: 0,
    lives: 3, gameOver: false, cleared: false, overCool: 0,
    hitstop: 0, pendingGameOver: false,
  });
  updateLives();
  $gameover.classList.remove('on', 'clear');
  $goRecord.classList.remove('show');
  duckBgm(0.5, 0.5);
}

// ---------------------------------------------------------------- theme apply
const setVec = (u, a) => u.value.set(a[0], a[1], a[2]);
let currentTheme = 'neon';
function applyTheme(key) {
  const th = THEMES[key];
  currentTheme = key;
  scene.fog.color.setHex(th.fog);
  scene.fog.near = th.fogNear;
  scene.fog.far = th.fogFar;
  setVec(skyUniforms.uTop, th.sky.top);
  setVec(skyUniforms.uMid, th.sky.mid);
  setVec(skyUniforms.uHorizon, th.sky.horizon);
  setVec(skyUniforms.uSunA, th.sky.sunA);
  setVec(skyUniforms.uSunB, th.sky.sunB);
  setVec(skyUniforms.uGlow, th.sky.glow);
  skyUniforms.uSunSize.value = th.sky.sunSize;
  skyUniforms.uStripes.value = th.sky.stripes;
  skyUniforms.uStars.value = th.sky.stars;
  gridMat.uniforms.uFog.value.setHex(th.fog);
  setVec(gridMat.uniforms.uGround, th.ground);
  setVec(gridMat.uniforms.uGridColor, th.gridColor);
  gridMat.uniforms.uGridIntensity.value = th.gridIntensity;
  runwayMat.uniforms.uFog.value.setHex(th.fog);
  setVec(runwayMat.uniforms.uBase, th.runway.base);
  setVec(runwayMat.uniforms.uLane, th.runway.lane);
  setVec(runwayMat.uniforms.uEdge, th.runway.edge);
  railL.material.color.copy(new THREE.Color(th.rails[0]).multiplyScalar(2.4));
  railR.material.color.copy(new THREE.Color(th.rails[1]).multiplyScalar(2.4));
  hemi.color.setHex(th.light.hemiSky);
  hemi.groundColor.setHex(th.light.hemiGround);
  keyLight.color.setHex(th.light.key);
  ballLight.color.setHex(th.light.point);
  glow.material.color.setHex(th.glowHex);
  buildBall(th.ball);
  applyObstacleTheme(th.obstacle);
  buildDecor(th.decor);
  wheel.visible = th.wheel;
}

// ---------------------------------------------------------------- screen flow
let ui = 'title'; // 'title' | 'select' | 'play'
let selIndex = 0;
function showScreen() {
  $title.classList.toggle('hidden', ui !== 'title');
  $select.classList.toggle('hidden', ui !== 'select');
  document.body.classList.toggle('menu', ui !== 'play');
}
function updateSelHighlight() {
  cards.forEach((c, i) => c.classList.toggle('active', i === selIndex));
}
function goSelect() {
  if (ui !== 'title') return;
  ui = 'select';
  selIndex = 0;
  applyTheme(THEME_KEYS[0]);
  updateSelHighlight();
  showScreen();
}
function selMove(d) {
  selIndex = (selIndex + d + 3) % 3;
  applyTheme(THEME_KEYS[selIndex]);
  updateSelHighlight();
  sfx.move();
}
function startStage(i) {
  selIndex = i;
  applyTheme(THEME_KEYS[i]);
  ui = 'play';
  showScreen();
  resetRun();
  Object.assign(state, {
    lane: 1, x: 0, jumpY: 0, vy: 0, grounded: true,
    speed: 17, distance: 0, score: 0, combo: 0,
    nextSpawn: 30, invincible: 1.0, shake: 0,
    demo: false, lives: 3, gameOver: false, cleared: false,
    overCool: 0, hitstop: 0, pendingGameOver: false,
  });
  updateLives();
  $gameover.classList.remove('on', 'clear');
  $goRecord.classList.remove('show');
  startAudioOnce();
}
function selConfirm() { startStage(selIndex); }

// ---------------------------------------------------------------- pause
let paused = false;
let pauseIndex = 0;
function updatePauseHighlight() {
  pauseOpts.forEach((o, i) => o.classList.toggle('active', i === pauseIndex));
}
function pause() {
  if (ui !== 'play' || state.gameOver || paused) return;
  paused = true;
  pauseIndex = 0;
  document.body.classList.add('paused');
  updatePauseHighlight();
  duckBgm(0.18, 0.3);
}
function resume() {
  if (!paused) return;
  paused = false;
  document.body.classList.remove('paused');
  duckBgm(0.5, 0.3);
}
function pauseMove(d) {
  pauseIndex = (pauseIndex + d + 2) % 2;
  updatePauseHighlight();
  sfx.move();
}
function backToSelect() {
  paused = false;
  document.body.classList.remove('paused');
  ui = 'select';
  resetRun();
  Object.assign(state, {
    lane: 1, x: 0, jumpY: 0, vy: 0, grounded: true,
    speed: 17, distance: 0, score: 0, combo: 0,
    nextSpawn: 30, invincible: 1.0, shake: 0,
    demo: true, lives: 3, gameOver: false, cleared: false,
    overCool: 0, hitstop: 0, pendingGameOver: false,
  });
  updateLives();
  $gameover.classList.remove('on', 'clear');
  updateSelHighlight();
  showScreen();
  duckBgm(0.5, 0.4);
}
function pauseConfirm() { if (pauseIndex === 0) resume(); else backToSelect(); }
pauseOpts.forEach((o, i) => {
  o.addEventListener('click', () => { if (!paused) return; pauseIndex = i; updatePauseHighlight(); pauseConfirm(); });
  o.addEventListener('pointerenter', () => { if (!paused) return; pauseIndex = i; updatePauseHighlight(); });
});
$pausebtn.addEventListener('click', () => { if (ui === 'play') pause(); });

cards.forEach((c, i) => {
  c.addEventListener('click', () => {
    if (ui !== 'select') return;
    startAudioOnce();
    selIndex = i; applyTheme(THEME_KEYS[i]); updateSelHighlight();
    selConfirm();
  });
  c.addEventListener('pointerenter', () => {
    if (ui !== 'select' || selIndex === i) return;
    selIndex = i; applyTheme(THEME_KEYS[i]); updateSelHighlight();
  });
});

// ---------------------------------------------------------------- actions
function jump() {
  if (!state.grounded) return;
  state.grounded = false;
  state.vy = 9.6;
  sfx.jump();
}
function setLane(l) { state.lane = THREE.MathUtils.clamp(l, 0, 2); }
function moveTo(lane) {
  const prev = state.lane;
  setLane(lane);
  if (state.lane !== prev) sfx.move();
}

// ---------------------------------------------------------------- input
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (ui === 'title') { startAudioOnce(); goSelect(); return; }
  if (ui === 'select') {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') selMove(-1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') selMove(1);
    else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') selConfirm();
    else if (e.code === 'Digit1') { selIndex = 0; applyTheme(THEME_KEYS[0]); updateSelHighlight(); selConfirm(); }
    else if (e.code === 'Digit2') { selIndex = 1; applyTheme(THEME_KEYS[1]); updateSelHighlight(); selConfirm(); }
    else if (e.code === 'Digit3') { selIndex = 2; applyTheme(THEME_KEYS[2]); updateSelHighlight(); selConfirm(); }
    return;
  }
  if (paused) {
    if (e.code === 'Escape' || e.code === 'KeyP') resume();
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') pauseMove(-1);
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') pauseMove(1);
    else if (e.code === 'Enter' || e.code === 'Space') pauseConfirm();
    return;
  }
  if (state.gameOver) { if (state.overCool <= 0) { startAudioOnce(); restart(); } return; }
  if (e.code === 'Escape' || e.code === 'KeyP') { pause(); return; }
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') moveTo(state.lane - 1);
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') moveTo(state.lane + 1);
  else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') jump();
});
let touchX = 0, touchY = 0;
addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
addEventListener('touchend', (e) => {
  if (ui === 'title') { startAudioOnce(); goSelect(); return; }
  if (ui === 'select') {
    const dx = e.changedTouches[0].clientX - touchX; // カードタップは click 側で処理。スワイプは送り
    if (dx > 30) selMove(1); else if (dx < -30) selMove(-1);
    return;
  }
  if (state.gameOver) { if (state.overCool <= 0) { startAudioOnce(); restart(); } return; }
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  if (dy < -40 && Math.abs(dy) > Math.abs(dx)) jump();
  else if (dx > 30) moveTo(state.lane + 1);
  else if (dx < -30) moveTo(state.lane - 1);
  else jump();
}, { passive: true });

// gamepad
const pad = { prev: [], zone: 0 };
const JUMP_BUTTONS = [0, 1, 2, 3, 12]; // A/B/X/Y + 十字上
addEventListener('gamepadconnected', () => { pad.prev = []; pad.zone = 0; });
function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const g of pads) { if (g) { gp = g; break; } }
  if (!gp) return;
  const down = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const justDown = (i) => down(i) && !pad.prev[i];
  const anyJust = gp.buttons.some((b, i) => b.pressed && !pad.prev[i]);
  const ax = gp.axes[0] || 0;
  const zone = down(14) || ax < -0.5 ? -1 : down(15) || ax > 0.5 ? 1 : 0;

  if (ui === 'title') {
    if (anyJust) { startAudioOnce(); goSelect(); }
  } else if (ui === 'select') {
    if (zone !== 0 && pad.zone === 0) selMove(zone);
    if (JUMP_BUTTONS.some(justDown)) selConfirm();
  } else if (paused) {
    if (justDown(12)) pauseMove(-1);          // 十字上
    else if (justDown(13)) pauseMove(1);       // 十字下
    if (justDown(0)) pauseConfirm();           // A
    if (justDown(1) || justDown(9)) resume();  // B / Start
  } else if (state.gameOver) {
    if (anyJust && state.overCool <= 0) { startAudioOnce(); restart(); }
  } else {
    if (justDown(9)) pause();                   // Start でポーズ
    else {
      if (zone !== 0 && pad.zone === 0) moveTo(state.lane + zone);
      if (JUMP_BUTTONS.some(justDown)) jump();
    }
  }
  pad.zone = zone;
  pad.prev = gp.buttons.map((b) => b.pressed);
}

// ---------------------------------------------------------------- spawner
function freeFrom(pool) { return pool.find((o) => !o.active); }
function spawnPattern() {
  if (Math.random() < 0.62) {
    const blockTwo = Math.random() < 0.4;
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    const blocked = blockTwo ? lanes.slice(0, 2) : lanes.slice(0, 1);
    for (const lane of blocked) {
      const o = freeFrom(obstacles);
      if (!o) continue;
      o.active = true;
      o.lane = lane;
      o.mesh.visible = true;
      o.mesh.position.set(LANES[lane], 0, SPAWN_Z);
    }
    if (Math.random() < 0.5) {
      const free = [0, 1, 2].filter((l) => !blocked.includes(l));
      const lane = free[(Math.random() * free.length) | 0];
      const r = freeFrom(rings);
      if (r) {
        r.active = true; r.lane = lane; r.air = false;
        r.mesh.visible = true;
        r.mesh.position.set(LANES[lane], 0.9, SPAWN_Z - 4);
      }
    }
  } else {
    const lane = (Math.random() * 3) | 0;
    const air = Math.random() < 0.3;
    for (let i = 0; i < 3; i++) {
      const r = freeFrom(rings);
      if (!r) break;
      r.active = true; r.lane = lane; r.air = air;
      r.mesh.visible = true;
      r.mesh.position.set(LANES[lane], air ? 2.5 : 0.9, SPAWN_Z - i * 7);
    }
  }
}

// ---------------------------------------------------------------- autopilot (demo)
function autopilot(dt) {
  state.autoCool -= dt;
  if (state.autoCool > 0) return;
  const danger = obstacles.find((o) => o.active && o.lane === state.lane && o.mesh.position.z > -22 && o.mesh.position.z < -2);
  if (danger) {
    const blocked = new Set(obstacles.filter((o) => o.active && o.mesh.position.z > -26 && o.mesh.position.z < -2).map((o) => o.lane));
    const options = [0, 1, 2].filter((l) => !blocked.has(l) && Math.abs(l - state.lane) === 1);
    const wide = [0, 1, 2].filter((l) => !blocked.has(l));
    const target = options.length ? options : wide;
    if (target.length) {
      const withRing = target.find((l) => rings.some((r) => r.active && r.lane === l && r.mesh.position.z > -40 && r.mesh.position.z < -4));
      setLane(withRing ?? target[(Math.random() * target.length) | 0]);
      state.autoCool = 0.3;
      return;
    }
  }
  const lure = rings.find((r) => r.active && r.mesh.position.z > -30 && r.mesh.position.z < -6);
  if (lure && lure.lane !== state.lane) {
    const blocked = new Set(obstacles.filter((o) => o.active && o.mesh.position.z > -26 && o.mesh.position.z < -2).map((o) => o.lane));
    const step = state.lane + Math.sign(lure.lane - state.lane);
    if (!blocked.has(step)) { setLane(step); state.autoCool = 0.3; }
  }
  const airRing = rings.find((r) => r.active && r.air && r.lane === state.lane && r.mesh.position.z > -9 && r.mesh.position.z < -5);
  if (airRing && state.grounded) jump();
}

// E2E・デバッグ用ハンドル
window.__neon = { state, doGameOver, restart, sfx, pollGamepad, applyTheme, goSelect, selMove, selConfirm, startStage, pause, resume, backToSelect, THEME_KEYS, getUI: () => ui, isPaused: () => paused };

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let scoreShown = -1;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  pollGamepad();

  // pause: 現在のフレームで凍結（時間も進めない）
  if (paused) {
    composer.render();
    return;
  }

  // game over: 世界を止めて空と観覧車だけ生かす
  if (state.gameOver) {
    state.overCool = Math.max(0, state.overCool - dt);
    skyUniforms.uTime.value = t;
    gradePass.uniforms.uTime.value = t;
    wheel.rotation.z += dt * 0.12;
    ball.rotation.x -= dt * 0.6;
    composer.render();
    return;
  }

  // hitstop: 被弾の瞬間に世界を凍結し、激しいシェイクで衝撃を演出
  if (state.hitstop > 0) {
    state.hitstop -= dt;
    const s = 0.34;
    camera.position.x = state.x * 0.55 + (Math.random() - 0.5) * s;
    camera.position.y = 3.1 + state.jumpY * 0.25 + (Math.random() - 0.5) * s;
    camera.lookAt(state.x * 0.7, 1.35 + state.jumpY * 0.3, -10);
    skyUniforms.uTime.value = t;
    gradePass.uniforms.uTime.value = t;
    if (state.hitstop <= 0 && state.pendingGameOver) {
      state.pendingGameOver = false;
      doGameOver();
    }
    composer.render();
    return;
  }

  state.speed = Math.min(40, 17 + state.distance * 0.02);
  state.distance += state.speed * dt;
  state.score += state.speed * dt * 8 * (1 + state.combo * 0.1);
  state.invincible = Math.max(0, state.invincible - dt);
  state.shake = Math.max(0, state.shake - dt * 3);

  if (state.demo) autopilot(dt);

  // player physics
  state.x = THREE.MathUtils.damp(state.x, LANES[state.lane], 10, dt);
  if (!state.grounded) {
    state.vy -= 24 * dt;
    state.jumpY += state.vy * dt;
    if (state.jumpY <= 0) { state.jumpY = 0; state.grounded = true; state.vy = 0; }
  }
  ballPivot.position.set(state.x, BALL_R + state.jumpY, 0);
  ball.rotation.x -= (state.speed / BALL_R) * dt * 0.45;
  ball.rotation.z = THREE.MathUtils.damp(ball.rotation.z, (LANES[state.lane] - state.x) * 0.25, 8, dt);
  glow.position.set(state.x, BALL_R * 0.7 + state.jumpY * 0.5, 0.2);
  ballLight.position.set(state.x, 1.6 + state.jumpY, 1.2);

  // camera follow + shake
  const shake = state.shake > 0 ? state.shake * 0.18 : 0;
  camera.position.x = THREE.MathUtils.damp(camera.position.x, state.x * 0.55, 6, dt) + (Math.random() - 0.5) * shake;
  camera.position.y = 3.1 + state.jumpY * 0.25 + (Math.random() - 0.5) * shake;
  camera.lookAt(state.x * 0.7, 1.35 + state.jumpY * 0.3, -10);
  camera.rotation.z = (state.x * 0.55 - camera.position.x) * 0.18 + (LANES[state.lane] - state.x) * 0.02;

  // world scroll
  const dz = state.speed * dt;
  gridMat.uniforms.uScroll.value += dz;
  skyUniforms.uTime.value = t;
  gradePass.uniforms.uTime.value = t;

  for (const b of decor) {
    b.position.z += dz;
    if (b.position.z > 18) b.position.z -= WORLD_DEPTH;
  }
  wheel.rotation.z += dt * 0.12;

  // streaks
  {
    const arr = streaks.geometry.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 2] += dz * 2.2;
      if (arr[i + 2] > 8) {
        arr[i] = (Math.random() - 0.5) * 30;
        arr[i + 1] = Math.random() * 9 + 0.3;
        arr[i + 2] = -130;
      }
    }
    streaks.geometry.attributes.position.needsUpdate = true;
  }

  // obstacles
  for (const o of obstacles) {
    if (!o.active) continue;
    o.mesh.position.z += dz;
    o.mesh.rotation.y += dt * 0.6; // 壁をゆっくり回して立体感を出す
    if (o.mesh.position.z > 7) { o.active = false; o.mesh.visible = false; continue; }
    if (state.invincible <= 0
      && o.lane === state.lane
      && Math.abs(o.mesh.position.z) < 0.75
      && state.jumpY < 1.15) {
      state.combo = 0;
      state.invincible = 1.6;
      state.shake = 1;
      $flash.style.opacity = '1';
      setTimeout(() => { $flash.style.opacity = '0'; }, 220);
      popup('CRASH!', o.mesh.position.clone().setY(1.6));
      sfx.crash();
      const fatal = !state.demo && state.lives - 1 <= 0;
      state.hitstop = fatal ? 0.2 : 0.1;
      if (!state.demo) {
        state.lives -= 1;
        updateLives();
        if (fatal) state.pendingGameOver = true;
      }
      break;
    }
  }

  // rings
  for (const r of rings) {
    if (!r.active) continue;
    r.mesh.position.z += dz;
    r.mesh.rotation.y += dt * 2.2;
    if (r.mesh.position.z > 7) { r.active = false; r.mesh.visible = false; continue; }
    const ballY = BALL_R + state.jumpY;
    if (r.lane === state.lane
      && Math.abs(r.mesh.position.z) < 0.7
      && Math.abs(ballY - r.mesh.position.y) < 1.0) {
      r.active = false;
      r.mesh.visible = false;
      state.combo += 1;
      state.score += 200 * state.combo;
      popup(`TRICK! +${200 * state.combo}`, r.mesh.position.clone().setY(r.mesh.position.y + 0.8));
      sfx.ring(state.combo);
    }
  }

  // goal gate
  const goalWindow = GOAL_DIST + SPAWN_Z;
  if (!state.demo && !goalActive && !state.cleared && state.distance >= goalWindow) {
    goalActive = true;
    goal.visible = true;
    goal.position.z = SPAWN_Z;
  }
  if (goalActive) {
    goal.position.z += dz;
    if (goal.position.z > 0.6) {
      goalActive = false;
      goal.visible = false;
      doGameOver(true);
    }
  }

  // spawn（ゴール手前ではハザードを止める）
  if (state.distance > state.nextSpawn && (state.demo || state.distance < goalWindow)) {
    spawnPattern();
    state.nextSpawn = state.distance + 18 + Math.random() * 12;
  }

  // HUD
  const sc = Math.floor(state.score);
  if (sc !== scoreShown) {
    scoreShown = sc;
    $score.textContent = sc.toLocaleString('en-US');
  }
  $dist.textContent = state.demo
    ? `${Math.floor(state.distance)}m ▸`
    : `${Math.min(Math.floor(state.distance), GOAL_DIST)} / ${GOAL_DIST}m`;
  if (state.combo >= 2) {
    $combo.textContent = `COMBO ×${state.combo}`;
    $combo.classList.add('on');
  } else {
    $combo.classList.remove('on');
  }

  composer.render();
}

// ---------------------------------------------------------------- boot
applyTheme('neon');
ui = 'title';
showScreen();
tick();

// ---------------------------------------------------------------- resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  gradePass.uniforms.uRes.value.set(innerWidth, innerHeight);
});
