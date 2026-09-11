/**
 * Texture audit for library models (+ any extra GLB paths passed as args):
 * reads each model's glTF JSON and reports image count, how many materials
 * bind a baseColorTexture, and how many rely on flat factors only.
 *
 *   node scripts/audit_textures.mjs [extra.glb ...]   (run from frontend/)
 */
import fs from 'node:fs';
import path from 'node:path';

const PUB = path.resolve('public');

function gltfJson(file) {
  const buf = fs.readFileSync(file);
  if (buf.length > 20 && buf.toString('utf8', 0, 4) === 'glTF') {
    const jl = buf.readUInt32LE(12);
    return JSON.parse(buf.toString('utf8', 20, 20 + jl));
  }
  return JSON.parse(buf.toString('utf8'));
}

function audit(file) {
  const j = gltfJson(file);
  const mats = j.materials || [];
  const withTex = mats.filter((m) =>
    m.pbrMetallicRoughness?.baseColorTexture ||
    m.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture).length;
  const images = (j.images || []).length;
  // external .gltf: check the referenced texture files actually exist
  let missingFiles = 0;
  if (!file.endsWith('.glb')) {
    for (const img of j.images || []) {
      if (img.uri && !img.uri.startsWith('data:')) {
        const p = path.join(path.dirname(file), decodeURIComponent(img.uri));
        if (!fs.existsSync(p)) missingFiles++;
      }
    }
  }
  return { images, mats: mats.length, withTex, missingFiles };
}

const rows = [];
const dataJs = fs.readFileSync(path.resolve('src', 'assets_data.js'), 'utf8');
const assets = JSON.parse(dataJs.match(/=\s*(\[[\s\S]*\]);/)[1]);
for (const a of assets) {
  if (!a.url) continue;
  const file = path.join(PUB, a.url.replace(/^\//, ''));
  try {
    rows.push({ id: a.id, ...audit(file) });
  } catch (e) {
    rows.push({ id: a.id, error: e.message.slice(0, 60) });
  }
}
for (const extra of process.argv.slice(2)) {
  try {
    rows.push({ id: extra, ...audit(extra) });
  } catch (e) {
    rows.push({ id: extra, error: e.message.slice(0, 60) });
  }
}

for (const r of rows) {
  if (r.error) {
    console.log(`${r.id.padEnd(45)} ERROR ${r.error}`);
    continue;
  }
  const flag = r.images === 0 || r.withTex === 0 ? '  << UNTEXTURED'
    : r.missingFiles ? `  << ${r.missingFiles} MISSING FILES` : '';
  console.log(`${r.id.padEnd(45)} imgs=${String(r.images).padStart(3)} ` +
    `mats=${String(r.mats).padStart(3)} texMats=${String(r.withTex).padStart(3)}${flag}`);
}
