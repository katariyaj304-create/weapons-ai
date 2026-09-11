/**
 * Dump the REAL exploded-view parts of every library model — the same nodes,
 * labels and ordering ExplodedAssemblyViewer produces at runtime — together
 * with each part's normalized geometry (where it sits in the weapon, how big
 * it is). The backend's engineering-intel research reads this so an LLM can
 * assign each part its true engineering identity even when the artist named
 * the meshes `defaultMaterial_3`.
 *
 * Detection MUST stay in sync with ExplodedAssemblyViewer.jsx pass 2 and
 * verify_explode_parts.mjs.
 *
 *   node scripts/dump_library_parts.mjs        (run from frontend/)
 *
 * Writes ../backend/generated/library_parts.json:
 *   { "/models/ak-47/model.glb": { id, name, axis, parts: [
 *       { key, label, axis_position, vertical_position, lateral_position,
 *         length_fraction, size_fraction, faces } ] } }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUB = path.join(FRONTEND, 'public');
const OUT = path.join(FRONTEND, '..', 'backend', 'generated', 'library_parts.json');

const dataJs = fs.readFileSync(path.join(FRONTEND, 'src', 'assets_data.js'), 'utf8');
const assets = JSON.parse(dataJs.match(/=\s*(\[[\s\S]*\]);/)[1]);

const GENERIC_NAME_RE = /^(defaultmaterial|mesh|node|object|geometry|primitive|scene|root)[_.\-\d]*$/i;

// ---------- texture-free GLTF parsing (Node has no image decoder) ----------
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
    const jsonLen = buf.readUInt32LE(12);
    const json = stripJson(JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')));
    let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
    const pad = (4 - (jsonBuf.length % 4)) % 4;
    jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]);
    const rest = buf.subarray(20 + jsonLen);
    const out = Buffer.alloc(20);
    buf.copy(out, 0, 0, 20);
    out.writeUInt32LE(20 + jsonBuf.length + rest.length, 8);
    out.writeUInt32LE(jsonBuf.length, 12);
    payload = Buffer.concat([out, jsonBuf, rest]);
  } else {
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

// ---------- viewer helpers ----------
function partLabel(node) {
  const clean = (raw) => raw.replace(/[_.\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (node.name && !GENERIC_NAME_RE.test(node.name)) return clean(node.name);
  let material = null;
  node.traverse((c) => {
    if (!material && c.isMesh && c.material) {
      const m = Array.isArray(c.material) ? c.material[0] : c.material;
      if (m.name && !GENERIC_NAME_RE.test(m.name)) material = m.name;
    }
  });
  return material ? clean(material) : clean(node.name || 'Part');
}

function countFaces(node) {
  let faces = 0;
  node.traverse((c) => {
    if (c.isMesh && c.geometry) {
      const g = c.geometry;
      faces += Math.floor((g.index ? g.index.count : g.attributes.position?.count || 0) / 3);
    }
  });
  return faces;
}

// Union-find split of a merged single mesh into connected shells (viewer parity)
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

  // Materialize each triangle list as its own mesh so it can be measured
  const src = geom.index ? geom.toNonIndexed() : geom;
  const srcPos = src.attributes.position;
  return comps.map((tris) => {
    const arr = new Float32Array(tris.length * 9);
    tris.forEach((t, n) => {
      for (let c = 0; c < 3; c++) {
        const vi = (index ? t * 3 + c : t * 3 + c);
        arr[n * 9 + c * 3 + 0] = srcPos.getX(vi);
        arr[n * 9 + c * 3 + 1] = srcPos.getY(vi);
        arr[n * 9 + c * 3 + 2] = srcPos.getZ(vi);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const m = new THREE.Mesh(g, mesh.material);
    m.applyMatrix4(mesh.matrix);
    return m;
  });
}

// ---------- detection (mirrors ExplodedAssemblyViewer pass 2) ----------
function detectPartNodes(scene) {
  scene.position.set(0, 0, 0);
  scene.scale.set(1, 1, 1);
  scene.rotation.set(0, 0, 0);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  scene.scale.setScalar(maxDim > 0 ? 6 / maxDim : 1);
  scene.updateMatrixWorld(true);
  box.setFromObject(scene);
  const center = new THREE.Vector3();
  box.getCenter(center);
  scene.position.set(-center.x, -box.min.y, -center.z);
  scene.updateMatrixWorld(true);
  box.setFromObject(scene);
  box.getCenter(center);
  box.getSize(size);

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
    } else {
      kids.splice(bestIdx, 1, ...bestSub);
    }
  }

  if (kids.length === 1) {
    const meshes = [];
    kids[0].traverse((x) => { if (x.isMesh) meshes.push(x); });
    if (meshes.length === 1) {
      const pieces = splitMeshByComponents(meshes[0]);
      if (pieces && pieces.length > 1) {
        const holder = meshes[0].parent;
        holder.remove(meshes[0]);
        pieces.forEach((p, i) => { p.name = `Segment_${i + 1}`; holder.add(p); });
        kids = pieces;
      }
    }
  }

  if (kids.length > 32) {
    scene.updateMatrixWorld(true);
    const sceneBox = new THREE.Box3().setFromObject(container);
    const sceneSize = new THREE.Vector3();
    sceneBox.getSize(sceneSize);
    const cells = new Map();
    const c = new THREE.Vector3();
    for (const k of kids) {
      new THREE.Box3().setFromObject(k).getCenter(c);
      const gx = Math.min(3, Math.floor(((c.x - sceneBox.min.x) / (sceneSize.x || 1)) * 4));
      const gy = Math.min(1, Math.floor(((c.y - sceneBox.min.y) / (sceneSize.y || 1)) * 2));
      const gz = Math.min(3, Math.floor(((c.z - sceneBox.min.z) / (sceneSize.z || 1)) * 4));
      const key = `${gx},${gy},${gz}`;
      let group = cells.get(key);
      if (!group) {
        group = new THREE.Group();
        group.name = `Section_${cells.size + 1}`;
        container.add(group);
        cells.set(key, group);
      }
      group.attach(k);
    }
    kids = [...cells.values()];
  }

  scene.updateMatrixWorld(true);
  return { kids, size, center };
}

// ---------- run ----------
const out = {};
let bad = 0;
for (const a of assets) {
  if (!a.url) { console.log(`${a.id.padEnd(42)} NO MODEL`); bad++; continue; }
  const file = path.join(PUB, decodeURIComponent(a.url).replace(/^\//, ''));
  try {
    const scene = await parseModel(file);
    const { kids, size, center } = detectPartNodes(scene);

    const axisIndex = size.x >= size.z ? 0 : 2;   // longitudinal axis (viewer parity)
    const lateralIndex = axisIndex === 0 ? 2 : 0;
    const half = (v) => (v > 1e-6 ? v / 2 : 1);

    // Viewer sorts parts along the longitudinal axis; keys are part_<sorted index>
    const measured = kids.map((node) => {
      const b = new THREE.Box3().setFromObject(node);
      const c = new THREE.Vector3();
      const s = new THREE.Vector3();
      b.getCenter(c);
      b.getSize(s);
      return { node, c, s };
    });
    measured.sort((p, q) => p.c.getComponent(axisIndex) - q.c.getComponent(axisIndex));

    const round = (v) => Math.round(v * 100) / 100;
    const parts = measured.map((m, i) => ({
      key: `part_${i}`,
      label: partLabel(m.node),
      axis_position: round((m.c.getComponent(axisIndex) - center.getComponent(axisIndex)) / half(size.getComponent(axisIndex)) ),
      vertical_position: round((m.c.y - center.y) / half(size.y)),
      lateral_position: round((m.c.getComponent(lateralIndex) - center.getComponent(lateralIndex)) / half(size.getComponent(lateralIndex))),
      length_fraction: round(m.s.getComponent(axisIndex) / (size.getComponent(axisIndex) || 1)),
      size_fraction: round((m.s.x * m.s.y * m.s.z) / (size.x * size.y * size.z || 1)),
      faces: countFaces(m.node),
    }));

    out[a.url] = {
      id: a.id,
      name: a.name,
      axis: axisIndex === 0 ? 'X' : 'Z',
      part_count: parts.length,
      parts,
    };
    const named = parts.filter((p) => !/^(part|segment|section)\b/i.test(p.label)).length;
    console.log(`${a.id.padEnd(42)} parts=${String(parts.length).padEnd(3)} named=${named}`);
    if (parts.length < 2) bad++;
  } catch (err) {
    bad++;
    console.log(`${a.id.padEnd(42)} PARSE ERROR: ${err.message || err}`);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log(`\nwrote ${path.resolve(OUT)}  (${Object.keys(out).length} assets, ${bad} problem(s))`);
process.exit(bad ? 1 : 0);
