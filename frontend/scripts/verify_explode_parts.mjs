/**
 * Headless verification that every library model splits into explodable
 * parts using the SAME detection pipeline as ExplodedAssemblyViewer:
 *   wrapper-chain descent -> >32-part spatial clustering -> coarse-group
 *   expansion -> connected-shell split for single-mesh models.
 *
 * Textures are stripped before parsing (Node has no image decoding); only
 * geometry and the node hierarchy matter here.
 *
 *   node scripts/verify_explode_parts.mjs        (run from frontend/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Minimal DOM polyfill so three's loaders run under Node
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUB = path.join(FRONTEND, 'public');

// ---------- load assets list ----------
const dataJs = fs.readFileSync(path.join(FRONTEND, 'src', 'assets_data.js'), 'utf8');
const assets = JSON.parse(dataJs.match(/=\s*(\[[\s\S]*\]);/)[1]);

// ---------- texture-free GLTF parsing ----------
function stripJson(json) {
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials || []) {
    for (const k of Object.keys(m)) if (/[tT]exture/.test(k)) delete m[k];
    if (m.pbrMetallicRoughness) {
      for (const k of Object.keys(m.pbrMetallicRoughness)) {
        if (/[tT]exture/.test(k)) delete m.pbrMetallicRoughness[k];
      }
    }
    if (m.extensions) delete m.extensions;
  }
  if (json.extensionsUsed) {
    json.extensionsUsed = json.extensionsUsed.filter((e) => !/texture|material/i.test(e));
  }
  return json;
}

function parseModel(file) {
  const buf = fs.readFileSync(file);
  let payload;
  if (file.toLowerCase().endsWith('.glb')) {
    // Rebuild the GLB with a stripped JSON chunk
    const jsonLen = buf.readUInt32LE(12);
    const json = stripJson(JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')));
    let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
    const pad = (4 - (jsonBuf.length % 4)) % 4;
    jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]);
    const rest = buf.subarray(20 + jsonLen); // BIN chunk(s) untouched
    const out = Buffer.alloc(20);
    buf.copy(out, 0, 0, 20);
    out.writeUInt32LE(20 + jsonBuf.length + rest.length, 8);
    out.writeUInt32LE(jsonBuf.length, 12);
    payload = Buffer.concat([out, jsonBuf, rest]);
  } else {
    // .gltf: strip textures and inline external buffers as data URIs
    const json = stripJson(JSON.parse(buf.toString('utf8')));
    for (const b of json.buffers || []) {
      if (b.uri && !b.uri.startsWith('data:')) {
        const bin = fs.readFileSync(path.join(path.dirname(file), decodeURIComponent(b.uri)));
        b.uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
      }
    }
    payload = JSON.stringify(json);
  }
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      payload instanceof Buffer
        ? payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)
        : payload,
      '', (gltf) => resolve(gltf.scene), reject);
  });
}

// ---------- detection pipeline (mirrors ExplodedAssemblyViewer pass 2) ----------
function splitMeshByComponents(mesh, maxParts = 16) {
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  if (!pos || pos.count === 0 || pos.count > 400000) return null;
  const index = geom.index ? geom.index.array : null;
  const triCount = Math.floor((index ? index.length : pos.count) / 3);
  if (triCount < 12) return null;
  const keyOf = new Map();
  const weld = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    let id = keyOf.get(k);
    if (id === undefined) { id = keyOf.size; keyOf.set(k, id); }
    weld[i] = id;
  }
  const parent = new Uint32Array(keyOf.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const vert = (t, c) => (index ? index[t * 3 + c] : t * 3 + c);
  for (let t = 0; t < triCount; t++) {
    const a = find(weld[vert(t, 0)]);
    const b = find(weld[vert(t, 1)]);
    const c = find(weld[vert(t, 2)]);
    if (a !== b) parent[a] = b;
    if (find(c) !== find(b)) parent[find(c)] = find(b);
  }
  const byRoot = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(weld[vert(t, 0)]);
    let arr = byRoot.get(r);
    if (!arr) { arr = []; byRoot.set(r, arr); }
    arr.push(t);
  }
  if (byRoot.size < 2) return null;
  let comps = [...byRoot.values()].sort((a, b) => b.length - a.length);
  const dustLimit = Math.max(8, triCount * 0.005);
  const dust = comps.filter((c) => c.length < dustLimit);
  comps = comps.filter((c) => c.length >= dustLimit);
  if (comps.length < 2) return null;
  if (comps.length > maxParts) {
    const rest = comps.slice(maxParts - 1);
    comps = comps.slice(0, maxParts - 1);
    comps.push(rest.flat());
  }
  if (dust.length) comps[0] = comps[0].concat(...dust);
  return comps; // triangle lists are enough for verification
}

function detectParts(scene) {
  scene.updateMatrixWorld(true);
  const hasGeometry = (o) => {
    let found = false;
    o.traverse((x) => { if (x.isMesh) found = true; });
    return found;
  };
  let container = scene;
  for (let depth = 0; depth < 12; depth++) {
    const k = container.children.filter(hasGeometry);
    if (k.length === 1 && !k[0].isMesh) { container = k[0]; continue; }
    break;
  }
  let kids = container.children.filter(hasGeometry);
  if (kids.length === 0) kids = [container];
  let layout = 'nodes';

  const descendWrappers = (node) => {
    for (let depth = 0; depth < 12; depth++) {
      if (node.isMesh) break;
      const sub = node.children.filter(hasGeometry);
      if (sub.length === 1) { node = sub[0]; continue; }
      break;
    }
    return node;
  };
  let guard = 0;
  while (kids.length < 6 && guard++ < 24) {
    let bestIdx = -1;
    let bestSub = null;
    kids.forEach((k, i) => {
      const dk = descendWrappers(k);
      const sub = dk.children.filter(hasGeometry);
      if (sub.length > (dk.isMesh ? 0 : 1) && (!bestSub || sub.length > bestSub.length)) {
        bestIdx = i; bestSub = sub;
      }
    });
    if (bestIdx < 0) break;
    const dk = descendWrappers(kids[bestIdx]);
    if (dk.isMesh) {
      for (const child of bestSub) dk.parent.attach(child);
      kids.splice(bestIdx, 1, dk, ...bestSub);
      layout = 'mesh-detached';
    } else {
      kids.splice(bestIdx, 1, ...bestSub);
      layout = 'expanded';
    }
  }

  if (kids.length === 1) {
    const meshes = [];
    kids[0].traverse((x) => { if (x.isMesh) meshes.push(x); });
    if (meshes.length === 1) {
      const comps = splitMeshByComponents(meshes[0]);
      if (comps) return { count: comps.length, layout: 'shell-split' };
      return { count: 1, layout: 'UNSPLITTABLE' };
    }
  }

  if (kids.length > 32) {
    scene.updateMatrixWorld(true);
    const sceneBox = new THREE.Box3().setFromObject(container);
    const sceneSize = new THREE.Vector3();
    sceneBox.getSize(sceneSize);
    const cells = new Set();
    const c = new THREE.Vector3();
    for (const k of kids) {
      new THREE.Box3().setFromObject(k).getCenter(c);
      const gx = Math.min(3, Math.floor(((c.x - sceneBox.min.x) / (sceneSize.x || 1)) * 4));
      const gy = Math.min(1, Math.floor(((c.y - sceneBox.min.y) / (sceneSize.y || 1)) * 2));
      const gz = Math.min(3, Math.floor(((c.z - sceneBox.min.z) / (sceneSize.z || 1)) * 4));
      cells.add(`${gx},${gy},${gz}`);
    }
    return { count: cells.size, layout: `clustered(${kids.length} nodes, ${layout})` };
  }
  return { count: kids.length, layout };
}

// ---------- run ----------
let bad = 0;
for (const a of assets) {
  if (!a.url) { console.log(`${a.id.padEnd(42)} NO MODEL`); bad++; continue; }
  const file = path.join(PUB, decodeURIComponent(a.url).replace(/^\//, ''));
  try {
    const scene = await parseModel(file);
    const { count, layout } = detectParts(scene);
    const flag = count < 2 ? '  <-- CANNOT EXPLODE' : '';
    if (count < 2) bad++;
    console.log(`${a.id.padEnd(42)} parts=${String(count).padEnd(4)} ${layout}${flag}`);
  } catch (err) {
    bad++;
    console.log(`${a.id.padEnd(42)} PARSE ERROR: ${err.message || err}`);
  }
}
console.log(`\n${assets.length} assets checked, ${bad} problem(s)`);
process.exit(bad ? 1 : 0);
