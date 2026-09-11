/** Debug: print the part nodes the viewer's pass-2 detection would pick for
 *  one GLB, with their names and child-name samples.
 *    node scripts/debug_kit_nodes.mjs <file.glb>
 */
import fs from 'node:fs';
import path from 'node:path';
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const file = process.argv[2];

function stripJson(json) {
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials || []) {
    for (const k of Object.keys(m)) if (/[tT]exture/.test(k)) delete m[k];
    if (m.pbrMetallicRoughness) {
      for (const k of Object.keys(m.pbrMetallicRoughness)) {
        if (/[tT]exture/.test(k)) delete m.pbrMetallicRoughness[k];
      }
    }
    if (m.extensions) delete m.extensions;
  }
  if (json.extensionsUsed) json.extensionsUsed = json.extensionsUsed.filter((e) => !/texture|material/i.test(e));
  return json;
}

const buf = fs.readFileSync(file);
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
const payload = Buffer.concat([out, jsonBuf, rest]);

const scene = await new Promise((resolve, reject) => {
  new GLTFLoader().parse(
    payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
    '', (g) => resolve(g.scene), reject);
});

const hasGeometry = (o) => {
  let found = false;
  o.traverse((x) => { if (x.isMesh) found = true; });
  return found;
};
let container = scene;
for (let depth = 0; depth < 12; depth++) {
  const kids = container.children.filter(hasGeometry);
  if (kids.length === 1 && !kids[0].isMesh) { container = kids[0]; continue; }
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

console.log(`container: ${JSON.stringify(container.name)}`);
console.log(`${kids.length} part nodes:`);
for (const k of kids) {
  const meshNames = [];
  k.traverse((c) => { if (c.isMesh && meshNames.length < 4) meshNames.push(c.name || '(unnamed)'); });
  console.log(`  node=${JSON.stringify(k.name)}  meshes: ${meshNames.map((n) => JSON.stringify(n)).join(', ')}`);
}
