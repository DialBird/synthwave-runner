// NEON RUSH — synthwave 3D runner
// 見栄え実験: シェーダー空 + ネオングリッド + ディスコボール + bloom/CA/vignette 全部盛り

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
const FOG_COLOR = 0x16042e;
const GOAL_DIST = 2000; // この距離を走り切るとステージクリア

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG_COLOR, 35, 230);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 900);
camera.position.set(0, 3.1, 6.2);

// ---------------------------------------------------------------- sky (shader dome)
const skyUniforms = { uTime: { value: 0 } };
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
    varying vec3 vDir;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec3 dir = normalize(vDir);
      float h = dir.y;

      // base gradient: deep purple top -> magenta horizon
      vec3 top = vec3(0.045, 0.0, 0.14);
      vec3 mid = vec3(0.30, 0.04, 0.46);
      vec3 hor = vec3(0.85, 0.20, 0.42);
      vec3 col = mix(mid, top, smoothstep(0.08, 0.65, h));
      col = mix(hor, col, smoothstep(-0.02, 0.22, h));

      // synthwave sun with scanline stripes
      vec3 sunDir = normalize(vec3(0.0, 0.085, -1.0));
      float ang = acos(clamp(dot(dir, sunDir), -1.0, 1.0));
      float R = 0.22;
      float disc = 1.0 - smoothstep(R * 0.97, R, ang);
      float sy = clamp((dir.y - (sunDir.y - R)) / (2.0 * R), 0.0, 1.0);
      float stripes = step(mix(0.78, 0.0, smoothstep(0.0, 0.75, sy)), fract(sy * 7.0 - uTime * 0.1));
      vec3 sunCol = mix(vec3(1.0, 0.22, 0.55), vec3(1.0, 0.88, 0.35), sy);
      col += disc * stripes * sunCol * 1.7;

      // sun glow + horizon haze
      col += pow(max(dot(dir, sunDir), 0.0), 24.0) * vec3(1.0, 0.38, 0.5) * 0.3;
      col += smoothstep(0.22, 0.0, abs(h)) * vec3(0.45, 0.08, 0.38) * 0.22;

      // twinkling stars
      vec2 sc = vec2(atan(dir.x, dir.z) * 42.0, dir.y * 85.0);
      vec2 cell = floor(sc);
      vec2 f = fract(sc) - 0.5;
      float rnd = hash(cell);
      float star = step(0.93, rnd) * smoothstep(0.22, 0.0, length(f))
                 * (0.55 + 0.45 * sin(uTime * 2.5 + rnd * 50.0));
      col += star * vec3(0.85, 0.9, 1.0) * smoothstep(0.10, 0.32, h);

      gl_FragColor = vec4(col, 1.0);
    }`,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(420, 40, 24), skyMat);
scene.add(skyDome);

// 空をキューブマップに焼いてディスコボールの反射に使う
const cubeRT = new THREE.WebGLCubeRenderTarget(128, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
const cubeCam = new THREE.CubeCamera(0.5, 900, cubeRT);
{
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(skyDome.geometry, skyMat));
  cubeCam.position.set(0, 2, 0);
  cubeCam.update(renderer, envScene);
}
scene.environment = cubeRT.texture;

// ---------------------------------------------------------------- neon grid floor
const gridUniforms = { uScroll: { value: 0 } };
const gridMat = new THREE.ShaderMaterial({
  uniforms: { ...gridUniforms, uFog: { value: new THREE.Color(FOG_COLOR) } },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uScroll;
    uniform vec3 uFog;
    varying vec3 vWorld;
    void main() {
      vec2 g = vec2(vWorld.x, vWorld.z + uScroll) / 4.0;
      vec2 q = abs(fract(g) - 0.5);
      float d = min(q.x, q.y) * 4.0;
      float fade = 1.0 - smoothstep(30.0, 180.0, length(vWorld.xz));
      vec3 col = vec3(0.02, 0.005, 0.05);
      col += (1.0 - smoothstep(0.0, 0.10, d)) * vec3(1.0, 0.16, 0.78) * 1.05 * fade; // 芯
      col += (1.0 - smoothstep(0.0, 0.9, d)) * vec3(0.45, 0.05, 0.38) * 0.3 * fade;  // にじみ
      col = mix(uFog, col, fade * 0.85 + 0.15);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
gridUniforms.uScroll = gridMat.uniforms.uScroll;
const gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), gridMat);
gridPlane.rotation.x = -Math.PI / 2;
scene.add(gridPlane);

// ---------------------------------------------------------------- runway
const runwayMat = new THREE.ShaderMaterial({
  uniforms: { uScroll: gridMat.uniforms.uScroll, uFog: { value: new THREE.Color(FOG_COLOR) } },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uScroll;
    uniform vec3 uFog;
    varying vec3 vWorld;
    void main() {
      float z = vWorld.z + uScroll;
      float fade = 1.0 - smoothstep(40.0, 200.0, -vWorld.z);
      vec3 col = vec3(0.035, 0.025, 0.075);
      // dashed cyan lane lines at x = ±1.1
      float lane = 1.0 - smoothstep(0.03, 0.07, abs(abs(vWorld.x) - 1.1));
      float dash = step(0.45, fract(z / 4.0));
      col += lane * dash * vec3(0.2, 0.95, 1.0) * 1.3 * fade;
      // edge glow
      float edge = smoothstep(2.6, 3.35, abs(vWorld.x));
      col += edge * vec3(0.85, 0.1, 0.65) * 0.8 * fade;
      // forward chevron pulses
      float pulse = smoothstep(0.92, 1.0, fract(z / 24.0));
      col += pulse * (1.0 - smoothstep(0.0, 2.4, abs(vWorld.x))) * vec3(0.25, 0.1, 0.5) * 0.5 * fade;
      col = mix(uFog, col, fade * 0.9 + 0.1);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const runway = new THREE.Mesh(new THREE.PlaneGeometry(6.9, 500), runwayMat);
runway.rotation.x = -Math.PI / 2;
runway.position.y = 0.02;
runway.position.z = -180;
scene.add(runway);

// neon rails on both edges
const railGeo = new THREE.BoxGeometry(0.12, 0.12, 500);
const railL = new THREE.Mesh(railGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x18e7ff).multiplyScalar(2.4) }));
railL.position.set(-3.5, 0.1, -180);
const railR = new THREE.Mesh(railGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2bd6).multiplyScalar(2.4) }));
railR.position.set(3.5, 0.1, -180);
scene.add(railL, railR);

// ---------------------------------------------------------------- buildings
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
const buildings = [];
const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
for (let i = 0; i < 44; i++) {
  const w = 4 + Math.random() * 7;
  const hgt = 7 + Math.random() * 26;
  const dep = 4 + Math.random() * 6;
  const tex = makeWindowTexture();
  tex.repeat.set(Math.max(1, Math.round(w / 5)), Math.max(1, Math.round(hgt / 9)));
  const sideMat = new THREE.MeshBasicMaterial({ map: tex, fog: true, color: new THREE.Color(1.5, 1.5, 1.5) });
  const mesh = new THREE.Mesh(buildingGeo, [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat]);
  mesh.scale.set(w, hgt, dep);
  const side = i % 2 === 0 ? -1 : 1;
  mesh.position.set(
    side * (9 + Math.random() * 26),
    hgt / 2,
    -Math.random() * WORLD_DEPTH,
  );
  scene.add(mesh);
  buildings.push(mesh);
}

// ---------------------------------------------------------------- ferris wheel (遠景)
const wheel = new THREE.Group();
{
  const rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff49c1).multiplyScalar(2.0), fog: true });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(17, 0.35, 8, 64), rimMat);
  wheel.add(rim);
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

// ---------------------------------------------------------------- player (disco ball)
const ball = new THREE.Group();
{
  // inner dark core
  ball.add(new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R * 0.93, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a0a22, metalness: 0.8, roughness: 0.4 }),
  ));
  // mirror tiles
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
  const tileGeo = new THREE.BoxGeometry(0.155, 0.155, 0.04);
  const tileMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 1.0, roughness: 0.12,
    envMap: cubeRT.texture, envMapIntensity: 1.6,
  });
  const tiles = new THREE.InstancedMesh(tileGeo, tileMat, normals.length);
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
const ballPivot = new THREE.Group(); // 横移動・ジャンプ用 / ball は回転専用
ballPivot.add(ball);
ballPivot.position.set(0, BALL_R, 0);
scene.add(ballPivot);

// glow sprite under the ball
function makeGlowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const glow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture('rgba(255,120,230,0.4)', 'rgba(255,40,180,0)'),
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
glow.scale.set(2.3, 2.3, 1);
scene.add(glow);

// ---------------------------------------------------------------- lights
scene.add(new THREE.HemisphereLight(0x6040c0, 0x180430, 0.7));
const keyLight = new THREE.DirectionalLight(0xff70b8, 1.4);
keyLight.position.set(-4, 8, 6);
scene.add(keyLight);
const ballLight = new THREE.PointLight(0xff4fd8, 18, 14, 2);
scene.add(ballLight);

// ---------------------------------------------------------------- obstacles
function makeZigzagTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a0414';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#ff2d78';
  ctx.lineWidth = 14;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let x = -16; x <= 272; x += 32) {
    const y = (x / 32) % 2 === 0 ? 34 : 94;
    x === -16 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = '#ffe9f4';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 250, 122);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const zigzagMat = new THREE.MeshBasicMaterial({ map: makeZigzagTexture(), fog: true, color: new THREE.Color(1.8, 1.8, 1.8) });
const obstacleGeo = new THREE.BoxGeometry(1.7, 1.05, 0.22);
const obstacles = [];
for (let i = 0; i < 14; i++) {
  const mesh = new THREE.Mesh(obstacleGeo, zigzagMat);
  mesh.visible = false;
  scene.add(mesh);
  obstacles.push({ mesh, active: false, lane: 0 });
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
  // GOAL バナー（市松＋テキスト）
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
const $start = document.getElementById('start');
const $lives = document.getElementById('lives');
const $gameover = document.getElementById('gameover');
const $goTitle = document.getElementById('go-title');
const $goScore = document.getElementById('go-score');
const $goDist = document.getElementById('go-dist');
const $goBest = document.getElementById('go-best');
const $goRecord = document.getElementById('go-record');

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
  lane: 1,
  x: 0,
  jumpY: 0,
  vy: 0,
  grounded: true,
  speed: 17,
  distance: 0,
  score: 0,
  combo: 0,
  nextSpawn: 30,
  invincible: 0,
  shake: 0,
  demo: true,
  autoCool: 0,
  lives: 3,
  gameOver: false,
  cleared: false,
  overCool: 0,
  hitstop: 0,
  pendingGameOver: false,
};

// リザルトのスコアをイージングでカウントアップ
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
updateLives();

const BEST_KEY = 'neonrush_best';
// cleared=true: 正規ゴール / false: ライフ切れ
function doGameOver(cleared = false) {
  state.gameOver = true;
  state.cleared = cleared;
  state.overCool = 0.9; // 直後の誤タップでリトライしないためのクールダウン
  let final = Math.floor(state.score);
  if (cleared) final += 3000 + state.lives * 1000; // クリアボーナス（残ライフ分）
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
  duckBgm(cleared ? 0.3 : 0.12, 0.5); // BGM を絞ってリザルトを際立たせる
}

function resetRun() {
  for (const o of obstacles) { o.active = false; o.mesh.visible = false; }
  for (const r of rings) { r.active = false; r.mesh.visible = false; }
  goalActive = false;
  goal.visible = false;
  goal.position.z = SPAWN_Z;
}

function restart() {
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
  duckBgm(0.5, 0.5); // BGM を戻す
}

function jump() {
  if (!state.grounded) return;
  state.grounded = false;
  state.vy = 9.6;
  sfx.jump();
}
function setLane(l) {
  state.lane = THREE.MathUtils.clamp(l, 0, 2);
}

// ---------------------------------------------------------------- input
function userTakeover() {
  startAudioOnce();
  if (!state.demo) return;
  state.demo = false;
  $start.classList.add('hidden');
  // 実プレイは 0m から仕切り直し（デモのスコアは持ち越さない）
  resetRun();
  state.distance = 0; state.score = 0; state.combo = 0;
  state.nextSpawn = 30; state.invincible = 1.0;
}
function moveTo(lane) {
  const prev = state.lane;
  setLane(lane);
  if (state.lane !== prev) sfx.move();
}
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (state.gameOver) {
    if (state.overCool <= 0) { startAudioOnce(); restart(); }
    return;
  }
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') { userTakeover(); moveTo(state.lane - 1); }
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') { userTakeover(); moveTo(state.lane + 1); }
  else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { userTakeover(); jump(); }
});
let touchX = 0, touchY = 0;
addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
addEventListener('touchend', (e) => {
  if (state.gameOver) {
    if (state.overCool <= 0) { startAudioOnce(); restart(); }
    return;
  }
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  userTakeover();
  if (dy < -40 && Math.abs(dy) > Math.abs(dx)) jump();
  else if (dx > 30) moveTo(state.lane + 1);
  else if (dx < -30) moveTo(state.lane - 1);
  else jump();
}, { passive: true });

// ---------------------------------------------------------------- gamepad
const pad = { prev: [], zone: 0 }; // zone: -1 左 / 0 中央 / 1 右（スティック・十字キー共通）
const JUMP_BUTTONS = [0, 1, 2, 3, 12]; // A/B/X/Y + 十字上（配置の癖を吸収）
addEventListener('gamepadconnected', () => { pad.prev = []; pad.zone = 0; });
function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const g of pads) { if (g) { gp = g; break; } }
  if (!gp) return;

  const down = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const justDown = (i) => down(i) && !pad.prev[i];
  const anyJust = gp.buttons.some((b, i) => b.pressed && !pad.prev[i]);

  if (state.gameOver) {
    if (anyJust && state.overCool <= 0) { startAudioOnce(); restart(); }
  } else {
    // レーン移動: 十字キー左右(14/15) or 左スティックX(axes[0]) のエッジで1段
    const ax = gp.axes[0] || 0;
    const zone = down(14) || ax < -0.5 ? -1 : down(15) || ax > 0.5 ? 1 : 0;
    if (zone !== 0 && pad.zone === 0) { userTakeover(); moveTo(state.lane + zone); }
    pad.zone = zone;
    if (JUMP_BUTTONS.some(justDown)) { userTakeover(); jump(); }
  }
  pad.prev = gp.buttons.map((b) => b.pressed);
}

// ---------------------------------------------------------------- spawner
function freeFrom(pool) { return pool.find((o) => !o.active); }
function spawnPattern() {
  if (Math.random() < 0.62) {
    // obstacles: block 1–2 lanes
    const blockTwo = Math.random() < 0.4;
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    const blocked = blockTwo ? lanes.slice(0, 2) : lanes.slice(0, 1);
    for (const lane of blocked) {
      const o = freeFrom(obstacles);
      if (!o) continue;
      o.active = true;
      o.lane = lane;
      o.mesh.visible = true;
      o.mesh.position.set(LANES[lane], 0.55, SPAWN_Z);
    }
    // ご褒美リングを空きレーンに添える
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
    // ring trio (30% は要ジャンプの空中リング)
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

// ---------------------------------------------------------------- autopilot (demo mode)
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
window.__neon = { state, doGameOver, restart, sfx, pollGamepad };

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let scoreShown = -1;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  pollGamepad();

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

  // hitstop: 被弾の瞬間に世界を凍結し、激しいシェイクで衝撃を演出する
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

  // speed ramps up over distance
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

  for (const b of buildings) {
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
    if (o.mesh.position.z > 7) { o.active = false; o.mesh.visible = false; continue; }
    if (state.invincible <= 0
      && o.lane === state.lane
      && Math.abs(o.mesh.position.z) < 0.75
      && state.jumpY < 1.15) {
      // hit: コンボ消滅 + ヒットストップ + シェイク + フラッシュ。実プレイ時のみライフが減る（デモは不死）
      state.combo = 0;
      state.invincible = 1.6;
      state.shake = 1;
      $flash.style.opacity = '1';
      setTimeout(() => { $flash.style.opacity = '0'; }, 220);
      popup('CRASH!', o.mesh.position.clone().setY(1.6));
      sfx.crash();
      const fatal = !state.demo && state.lives - 1 <= 0;
      state.hitstop = fatal ? 0.2 : 0.1; // 致命傷は長めに凍結
      if (!state.demo) {
        state.lives -= 1;
        updateLives();
        if (fatal) state.pendingGameOver = true; // hitstop 明けに doGameOver
      }
      break; // 同一フレームで複数被弾しない
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

  // goal gate: ゴール手前(=ゲートが流れて来る距離分)で出現させ、通過したらクリア。デモは無限走行
  const goalWindow = GOAL_DIST + SPAWN_Z; // ゲートが0に着く頃に distance が GOAL_DIST になる
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
      doGameOver(true); // 正規ゴール
    }
  }

  // spawn（ゴール手前のラン区間ではハザードを止めてクリーンに走らせる）
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
tick();

// ---------------------------------------------------------------- resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  gradePass.uniforms.uRes.value.set(innerWidth, innerHeight);
});
