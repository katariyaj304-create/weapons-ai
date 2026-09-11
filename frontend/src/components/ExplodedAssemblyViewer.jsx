/**
 * ExplodedAssemblyViewer — professional interactive exploded view.
 *
 * Accepts TWO kinds of GLB:
 *   1. Pipeline assemblies with the strict hierarchy Outer_Shell +
 *      Inner_Part_1..5 — shell lifts off, parts cascade into a field-strip
 *      line along the weapon's longitudinal axis (CAD auto-explode pattern).
 *   2. ANY multi-part GLB (artist kits, Sketchfab models): every top-level
 *      geometry node becomes a tracked part. Labels come from node names or,
 *      when those are generic ("defaultMaterial_7"), from material names
 *      ("Handguard_DMR" -> "Handguard DMR").
 *      - Kit-style models whose parts are already laid out explode RADIALLY
 *        (the authored layout spreads apart, knolling-style).
 *      - Assembled models with many clustered parts explode into a GRID.
 *
 * Presentation: staggered cascade animation, balloon callouts with leader
 * lines, hover highlight, click-to-isolate, and a collapsible SPEC panel
 * listing every component (name, triangle count, size, risk tier) —
 * an engineering-sheet look for generated and imported assemblies alike.
 */
import React, { useRef, useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { Canvas, createPortal } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, ContactShadows, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';

const SHELL_NAME = 'Outer_Shell';
const PART_PREFIX = 'Inner_Part_';
const ACCENT = new THREE.Color('#0066ff');
const GENERIC_NAME_RE = /^(defaultmaterial|material|mesh|node|object|geometry|primitive|scene|root)[_.\-\d]*$/i;
// Asset-pipeline ids (Sketchfab often names materials with raw UUIDs)
const UUID_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isGenericName = (s) => GENERIC_NAME_RE.test(s) || UUID_NAME_RE.test(s);

const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const RISK_COLORS = { CRITICAL: '#c62828', ELEVATED: '#b8860b', STABLE: '#1a7f37' };

/** Per-item progress inside a staggered cascade driven by one global factor. */
function cascadeProgress(factor, order, count) {
  if (count <= 1) return easeInOutCubic(factor);
  // With many parts, higher overlap keeps the full sweep tight.
  const overlap = count > 8 ? 0.8 : 0.45;
  const window = 1 / (1 + (count - 1) * (1 - overlap));
  const start = order * (1 - overlap) * window;
  const p = Math.min(Math.max((factor - start) / window, 0), 1);
  return easeInOutCubic(p);
}

/** Convert a world-space offset into `node`'s parent space (handles rotated /
 *  scaled ancestor chains from trimesh and Sketchfab exports alike). */
function worldOffsetToParentLocal(node, worldOffset) {
  const q = new THREE.Quaternion();
  node.parent.getWorldQuaternion(q);
  const s = new THREE.Vector3();
  node.parent.getWorldScale(s);
  return worldOffset.clone().applyQuaternion(q.invert()).divide(s);
}

/** Human label for a part node: its own name; for generically-named groups,
 *  the name of the DOMINANT named descendant mesh (artist kits often nest
 *  "Front Sight", "Gas Tube"... under an unnamed wrapper); else its first
 *  named material. */
function partLabel(node, aliases = FIREARM_ALIASES) {
  const clean = (raw) => raw.replace(/[_.\-#:|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const ownName = clean(node.name || '');
  // "Section_3"/"Segment_5" are OUR grouping names, not the artist's — look
  // inside those for the real part names instead of accepting them.
  if (ownName && !isGenericName(node.name) && !MEANINGLESS_RE.test(ownName)) {
    return ownName;
  }
  // A name containing real weapon nomenclature ("Upper Receiver") beats a
  // bigger part with an incidental name ("Strap") when naming a group.
  const hasAliasTerm = (nm) => {
    const s = clean(nm).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return aliases.some(([, rx]) => rx.test(s));
  };
  let bestName = null;
  let bestSize = -1;
  let bestAliasName = null;
  let bestAliasSize = -1;
  let material = null;
  const bbSize = new THREE.Vector3();
  const wScale = new THREE.Vector3();
  node.traverse((c) => {
    if (!c.isMesh) return;
    // Dominance by world bbox volume, NOT vertex count — a coil spring has
    // thousands of vertices but the receiver is what the group IS.
    let size = 0;
    if (c.geometry) {
      if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
      if (c.geometry.boundingBox) {
        c.geometry.boundingBox.getSize(bbSize);
        c.getWorldScale(wScale);
        size = Math.abs(bbSize.x * wScale.x * bbSize.y * wScale.y * bbSize.z * wScale.z);
      }
    }
    let nm = c.name && !isGenericName(c.name) ? c.name
      : (c.userData?.realName || null);
    if (!nm) {
      // glTF loaders often put the meaningful name on the mesh's parent node
      const pn = c.parent && c.parent !== node ? c.parent.name : '';
      if (pn && !isGenericName(pn)) nm = pn;
    }
    if (nm && size > bestSize) { bestSize = size; bestName = nm; }
    if (nm && size > bestAliasSize && hasAliasTerm(nm)) {
      bestAliasSize = size;
      bestAliasName = nm;
    }
    if (!material && c.material) {
      const m = Array.isArray(c.material) ? c.material[0] : c.material;
      if (m.name && !isGenericName(m.name)) material = m.name;
    }
  });
  // Nomenclature priority holds only when the alias-named part is a real
  // share of the group's bulk — a tiny "gear" must not rename a hull group.
  const aliasWins = bestAliasName && bestAliasSize >= 0.06 * Math.max(bestSize, 1e-12);
  if (aliasWins || bestName) return clean(aliasWins ? bestAliasName : bestName);
  return material ? clean(material) : clean(node.name || 'Part');
}

// ---------------------------------------------------------------------------
// Deterministic part nomenclature — NO AI. Informal artist names are mapped to
// proper engineering terms; parts with meaningless names are identified from
// pure geometry (per weapon class) and marked "inferred".
// ---------------------------------------------------------------------------
// Ordered: first match wins, so specific terms sit above general ones.
const FIREARM_ALIASES = [
  ['Bolt Carrier Group', /\b(bolt ?carrier|bcg)\b/i],
  ['Charging Handle', /\bcharging ?handle\b/i],
  ['Dust Cover', /\b(dust|top) ?cover\b/i],
  ['Gas Piston', /\bgas ?piston\b/i],
  ['Gas Tube', /\bgas ?tube\b/i],
  ['Gas Block', /\bgas ?block\b/i],
  ['Front Sight', /\b(front ?sight|foresight)\b/i],
  ['Rear Sight', /\brear ?sight\b/i],
  ['Optical Sight', /\b(scope|optics?|reflex|holo(graphic)? ?sight|red ?dot|acog)\b/i],
  ['Suppressor', /\b(sup?pres?sors?|silencer|moderator)\b/i],
  ['Muzzle Device', /\b(muzzle ?(brake|device)?|flash ?(hider)?|compensator)\b/i],
  ['Vertical Foregrip', /\b(fore ?grip|vertical ?grip)\b/i],
  ['Handguard', /\b(hand ?guard|fore ?end|forend)\b/i],
  ['Trigger Guard', /\btrigger ?guard\b/i],
  ['Trigger', /\btrigger\b/i],
  ['Hammer', /\bhammer\b/i],
  ['Fire Selector', /\b(selector|safety|fire ?select\w*)\b/i],
  ['Firing Pin', /\bfiring ?pin\b/i],
  ['Extractor', /\bextractor\b/i],
  ['Recoil Assembly', /\b(recoil|buffer) ?(spring|tube|assembly|rod)?\b/i],
  ['Bolt Carrier Group', /\bcarrier\b/i],
  ['Bolt', /\bbolt\b/i],
  ['Upper Receiver', /\bupper ?(receiver)?\b/i],
  ['Lower Receiver', /\blower ?(receiver)?\b/i],
  ['Receiver', /\b(receiver|body|frame)\b/i],
  ['Slide', /\bslide\b/i],
  ['Barrel', /\bbarrel\b/i],
  ['Drum Magazine', /\bdrum\b/i],
  ['Magazine', /\b(mag(azine)?s?|clip)\b/i],
  ['Buttplate', /\bbutt ?plate\b/i],
  ['Cheek Rest', /\bcheek ?(rest|riser|pad)?\b/i],
  ['Stock', /\b(butt ?stock|stock|butt)\b/i],
  ['Pistol Grip', /\b(pistol ?grip|grip)\b/i],
  ['Bipod', /\bbipod\b/i],
  ['Accessory Rail', /\b(rail|picatinny)\b/i],
  ['Sling Mount', /\bsling ?(mount|swivel)?\b/i],
  ['Bayonet', /\bbayonet\b/i],
  ['Cleaning Rod', /\bcleaning ?rod\b/i],
  ['Cartridge', /\b(bullet|cartridge|ammo|round|casing)s?\b/i],
  ['Weapon Light', /\b(flash ?light|torch|laser)\b/i],
];

// Tanks / armored fighting vehicles
const VEHICLE_ALIASES = [
  ['Muzzle Brake', /\bmuzzle ?brake\b/i],
  ['Gun Muzzle', /\bmuzzle\b/i],
  ['Main Gun Barrel', /\b(gun ?barrel|main ?gun|cannon|gun ?tube|barrel)\b/i],
  ['Gun Mantlet', /\bmantlet\b/i],
  ['Autoloader', /\bauto ?loader\b/i],
  ["Commander's Cupola", /\bcupola\b/i],
  ['Turret Assembly', /\bturret\b/i],
  ['Crew Hatch', /\bhatch\b/i],
  ['Crew Station', /\b(commander|gunner|driver|loader|crew)\b/i],
  ['Periscope / Sight', /\b(periscope|sight|optics?|rangefinder|scope|lens)\b/i],
  ['Smoke Grenade Launcher', /\bsmoke\b/i],
  ['ERA Block', /\b(era|reactive ?armou?r)\b/i],
  ['Side Skirt', /\b(side ?skirt|skirt)s?\b/i],
  ['Glacis Plate', /\bglacis\b/i],
  ['Drive Sprocket', /\bsprockets?\b/i],
  ['Idler Wheel', /\bidlers?\b/i],
  ['Return Roller', /\b(return|support) ?rollers?\b/i],
  ['Road Wheel', /\b(road ?wheels?|bogies?)\b/i],
  ['Track Assembly', /\b(tracks?|treads?|caterpillar)\b/i],
  ['Suspension', /\b(suspension|torsion ?(bar)?|shock ?absorber)\b/i],
  ['Drive Gear', /\bgears?\b/i],
  ['Wheel', /\b(wheels?|tyres?|tires?)\b/i],
  ['Fender', /\b(fenders?|mud ?guards?)\b/i],
  ['Exhaust', /\bexhaust\b/i],
  ['Engine Deck', /\b(engine|motor|power ?pack)\b/i],
  ['Fuel Drum', /\b(fuel ?(drum|tank|barrel)?|jerry ?can)\b/i],
  ['Tow Cable', /\b(tow ?(cable|hook)?|winch|cable)\b/i],
  ['Antenna', /\b(antenna|aerial)\b/i],
  ['Headlight', /\b(head ?lights?|lights?|lamps?|lanterns?)\b/i],
  ['Machine Gun', /\b(machine ?gun|mg ?\d*|coax\w*|dshk|pkt|browning)\b/i],
  ['Main Gun', /\bguns?\b/i],
  ['Stowage', /\b(stowage|storage|tool ?box|bins?|crates?|baskets?|rack)\b/i],
  ['Armor Plate', /\b(armou?r|applique|plate)\b/i],
  ['Vision Block', /\b(vision ?(block|port)|view ?port|window)\b/i],
  ['Hull', /\b(hull|body|chassis|frame)\b/i],
];

// Missiles / rockets / torpedoes
const MISSILE_ALIASES = [
  ['Nose Cone', /\b(nose ?(cone)?|radome|ogive)\b/i],
  ['Seeker Head', /\b(seeker|ir ?head|sensor ?head)\b/i],
  ['Guidance Section', /\b(guidance|avionics|gyro|electronics)\b/i],
  ['Warhead Section', /\b(warhead|payload|charge)\b/i],
  ['Canard Fin', /\bcanards?\b/i],
  ['Tail Fin', /\b(fins?|stabilizers?|stabilisers?|empennage|tail)\b/i],
  ['Wing Strake', /\b(strakes?|wings?)\b/i],
  ['Booster Stage', /\b(boosters?|stage ?\d*)\b/i],
  ['Rocket Motor', /\b(motor|propellant|propulsion|fuel ?tank)\b/i],
  ['Rocket Nozzle', /\b(nozzles?|thrusters?|exhaust|venturi)\b/i],
  ['Umbilical Conduit', /\b(umbilical|conduit|raceway|cable ?duct)\b/i],
  ['Launch Lug', /\b(lugs?|hangers?|rail)\b/i],
  ['Airframe / Motor Casing', /\b(body|airframe|fuselage|casing|tube|hull|shell)\b/i],
];

// Towed / self-propelled artillery, mortars, AA guns
const ARTILLERY_ALIASES = [
  ['Muzzle Brake', /\bmuzzle ?brake\b/i],
  ['Breech Assembly', /\b(breech|breach ?block)\b/i],
  ['Gun Barrel', /\b(barrel|gun ?tube|cannon|ordnance|tube)\b/i],
  ['Recoil System', /\b(recoil|recuperator|buffer)\b/i],
  ['Gun Cradle', /\bcradle\b/i],
  ['Gun Shield', /\bshield\b/i],
  ['Elevation Gear', /\b(elevation|elevating|hand ?wheel|handwheel)\b/i],
  ['Traverse Mechanism', /\btraverse\b/i],
  ['Trail', /\b(trails?|spades?)\b/i],
  ['Axle', /\baxle\b/i],
  ['Wheel', /\b(wheels?|tyres?|tires?)\b/i],
  ['Sight Assembly', /\b(sights?|optics?|scope)\b/i],
  ['Ammunition', /\b(shells?|rounds?|projectiles?|ammo|cartridges?)\b/i],
  ['Bipod / Base Plate', /\b(bipod|base ?plate|tripod)\b/i],
  ['Carriage', /\b(carriage|mount|chassis|frame|body|base)\b/i],
];

// Fixed-wing aircraft, helicopters, drones
const AIRCRAFT_ALIASES = [
  ['Cockpit Canopy', /\b(canopy|windshield|windscreen|glass)\b/i],
  ['Cockpit', /\bcockpit\b/i],
  ['Ejection Seat', /\b(ejection ?seat|seat)\b/i],
  ['Radome', /\b(radome|nose ?(cone)?)\b/i],
  ['Vertical Stabilizer', /\b(vertical ?stab\w*|tail ?fin|rudder|fin)\b/i],
  ['Horizontal Stabilizer', /\b(horizontal ?stab\w*|elevator|tail ?plane|stabilator)\b/i],
  ['Aileron', /\baileron\b/i],
  ['Flap', /\bflaps?\b/i],
  ['Slat', /\bslats?\b/i],
  ['Main Rotor', /\b(main ?rotor|rotor ?(head|blade)?s?)\b/i],
  ['Tail Rotor', /\btail ?rotor\b/i],
  ['Tail Boom', /\btail ?boom\b/i],
  ['Wing', /\bwings?\b/i],
  ['Engine Nozzle', /\b(nozzles?|after ?burner)\b/i],
  ['Air Intake', /\b(intakes?|inlets?)\b/i],
  ['Engine', /\b(engine|turbine|turbofan|nacelle|exhaust)\b/i],
  ['Propeller', /\b(propell?ers?|prop|blades?)\b/i],
  ['Landing Gear', /\b(landing ?gear|under ?carriage|gear|struts?|wheels?)\b/i],
  ['Weapons Pylon', /\b(pylons?|hard ?points?)\b/i],
  ['Drop Tank', /\b(drop ?tank|fuel ?tank)\b/i],
  ['Missile', /\bmissiles?\b/i],
  ['Bomb', /\bbombs?\b/i],
  ['Fuselage', /\b(fuselage|body|hull|airframe)\b/i],
];

// Warships / submarines
const SHIP_ALIASES = [
  ['Bridge', /\bbridge\b/i],
  ['Superstructure', /\bsuperstructure\b/i],
  ['Main Gun Turret', /\bturrets?\b/i],
  ['Naval Gun', /\b(guns?|cannon)\b/i],
  ['Missile Launcher', /\b(vls|launcher|missiles?)\b/i],
  ['Torpedo Tube', /\btorpedo\b/i],
  ['Radar / Sensor Mast', /\b(radar|masts?|antenna|sensors?)\b/i],
  ['Funnel', /\b(funnels?|smoke ?stacks?)\b/i],
  ['Conning Tower', /\b(conning|sail)\b/i],
  ['Periscope', /\bperiscope\b/i],
  ['Propeller', /\b(propell?ers?|screws?)\b/i],
  ['Rudder', /\brudders?\b/i],
  ['Anchor', /\banchors?\b/i],
  ['Lifeboat', /\b(life ?boats?|rafts?|dinghy)\b/i],
  ['Deck', /\bdecks?\b/i],
  ['Hull', /\b(hull|body)\b/i],
];

const ALIASES_BY_CLASS = {
  firearm: FIREARM_ALIASES,
  tank: VEHICLE_ALIASES,
  missile: MISSILE_ALIASES,
  artillery: ARTILLERY_ALIASES,
  mortar: ARTILLERY_ALIASES,
  aircraft: AIRCRAFT_ALIASES,
  ship: SHIP_ALIASES,
};

// Weapon class from the asset's NAME (the user's search term / model title).
// Ordered: the first pattern that hits wins. Handhelds ("RPG-7", "grenade
// launcher") are short-circuited to firearm so "rocket" never claims them.
const CLASS_NAME_PATTERNS = [
  ['firearm', /\b(rifle|pistol|revolver|smg|shotgun|carbine|sniper|rpg|bazooka|panzerfaust|grenade ?launcher|handgun|musket|crossbow)\b/i],
  ['tank', /\b(tank|mbt|panzer|abrams|leopard|challenger|merkava|armata|t-?\d{2}\b|ztz|al[- ]?khalid|arjun)\b/i],
  ['tank', /\b(apc|ifv|afv|armou?red|bmp|btr|bradley|stryker|lav|mrap|humvee|namer|marder|puma|centauro)\b/i],
  ['mortar', /\bmortar\b/i],
  ['artillery', /\b(howitzer|artillery|field ?gun|m777|m109|paladin|d-?[23]0|2s\d+|gvozdika|msta|caesar|pzh ?2000|flak|aa[- ]?gun|anti[- ]?aircraft|bofors|oerlikon)\b/i],
  ['missile', /\b(missile|icbm|slbm|torpedo|atgm|sam|tomahawk|javelin|scud|iskander|kalibr|brahmos|patriot|s-?[34]00|hellfire|stinger|exocet|harpoon|cruise|ballistic|warhead|rocket)\b/i],
  ['aircraft', /\b(jet|fighter|aircraft|air ?plane|plane|bomber|helicopter|helo|chopper|gunship|drone|uav|f[- ]?\d{1,3}\b|su[- ]?\d{2}|mig[- ]?\d{2}|kc[- ]?\d{1,3}\b|ch[- ]?\d{1,3}\b|ah[- ]?\d{1,3}\b|uh[- ]?\d{1,3}\b|c[- ]?130\b|boeing|airbus|sikorsky|lockheed|tanker|awacs|osprey|chinook|stallion|apache|black ?hawk|hind|rafale|typhoon|gripen|raptor)\b/i],
  ['ship', /\b(ship|battleship|destroyer|frigate|corvette|submarine|u[- ]?boat|carrier|cruiser|warship|gunboat)\b/i],
];

function weaponClassFromName(name) {
  for (const [cls, rx] of CLASS_NAME_PATTERNS) {
    if (rx.test(name || '')) return cls;
  }
  return null;
}

/** Shape fallback when the name says nothing: a long, radially compact body
 *  (both cross dims small AND similar) reads as a missile. Firearms keep
 *  their own gate inside classifyFirearmParts. */
function weaponClassFromShape(size) {
  const sorted = [size.x, size.y, size.z].sort((a, b) => b - a);
  // 4.5:1 keeps long trucks/TELs (≈4:1) out; real missiles run 8:1+
  if (sorted[0] >= 4.5 * sorted[1] && sorted[1] <= 1.8 * sorted[2]) return 'missile';
  return null;
}

/** Normalized geometry metrics per part, shared by the class identifiers:
 *  a (0..1 along the long axis), yRel (0 bottom..1 top), latRel (-1..1 signed
 *  lateral offset), v (volume share), elong (stretch along the long axis),
 *  flat (plate/fin proportions). */
function partMetrics(partInfo, size, center, axis) {
  const long = Math.max(size.getComponent(axis), 1e-6);
  const latAxis = axis === 1 ? (size.x >= size.z ? 0 : 2) : (axis === 0 ? 2 : 0);
  const lat = Math.max(size.getComponent(latAxis), 1e-6);
  const axMin = center.getComponent(axis) - long / 2;
  const totalVol = partInfo.reduce(
    (s, p) => s + p.sizes.x * p.sizes.y * p.sizes.z, 0) || 1e-9;
  const yBottom = center.y - size.y / 2;
  return partInfo.map((p) => {
    const dims = [p.sizes.x, p.sizes.y, p.sizes.z];
    const maxDim = Math.max(...dims);
    const minDim = Math.min(...dims);
    const axExt = p.sizes.getComponent(axis);
    const others = dims.filter((_, i) => i !== axis);
    return {
      p,
      a: (p.center.getComponent(axis) - axMin) / long,
      yRel: (p.center.y - yBottom) / Math.max(size.y, 1e-6),
      latRel: (p.center.getComponent(latAxis) - center.getComponent(latAxis)) / (lat / 2),
      v: (p.sizes.x * p.sizes.y * p.sizes.z) / totalVol,
      elong: axExt / Math.max(Math.max(...others), 1e-6),
      flat: minDim < 0.22 * maxDim,
      axExt, latExt: p.sizes.getComponent(latAxis), maxDim, minDim,
    };
  });
}

const sideTag = (x) =>
  x.latRel > 0.28 ? ' (Right)' : x.latRel < -0.28 ? ' (Left)' : '';

/** Tank / AFV: turret = raised mass, main gun = long thin elevated tube,
 *  tracks/running gear = low mirrored side runs, hull = largest low volume. */
function classifyTankParts(partInfo, size, center, axisIndex) {
  if (partInfo.length < 2) return null;
  const ms = partMetrics(partInfo, size, center, axisIndex);
  const maxV = Math.max(...ms.map((x) => x.v));
  const names = new Map();
  for (const x of ms) {
    const s = sideTag(x);
    let name;
    if (x.elong >= 3 && x.yRel > 0.45 && x.v <= 0.12) name = 'Main Gun Barrel';
    else if (x.v === maxV && x.yRel <= 0.62) name = 'Hull';
    else if (x.yRel >= 0.5 && x.v >= 0.05) name = 'Turret Assembly';
    else if (x.yRel < 0.42 && Math.abs(x.latRel) > 0.4 && x.elong >= 1.8) name = `Track Assembly${s}`;
    else if (x.yRel < 0.42 && Math.abs(x.latRel) > 0.35) name = `Running Gear${s}`;
    else if (x.yRel > 0.78 && x.v < 0.03) name = 'Cupola / Hatch';
    else if (Math.abs(x.latRel) > 0.5 && x.flat) name = `Side Skirt${s}`;
    else if (x.yRel >= 0.5) name = 'Turret Section';
    else name = 'Hull Section';
    names.set(x.p.node, name);
  }
  // A tank has ONE main gun: keep the most elongated candidate, the rest
  // are turret/hull structure (a TEL's missile body triggers this rule).
  const barrels = ms.filter((x) => names.get(x.p.node) === 'Main Gun Barrel');
  if (barrels.length > 1) {
    barrels.sort((a, b) => b.elong - a.elong);
    for (const x of barrels.slice(1)) {
      names.set(x.p.node, x.yRel >= 0.5 ? 'Turret Section' : 'Hull Section');
    }
  }
  // The hull must exist: when the overall largest mass sat high (turret won
  // maxV), promote the biggest remaining hull section to Hull.
  if (![...names.values()].includes('Hull')) {
    let bestHull = null;
    for (const x of ms) {
      if (names.get(x.p.node) === 'Hull Section' &&
          (!bestHull || x.v > bestHull.v)) bestHull = x;
    }
    if (bestHull) names.set(bestHull.p.node, 'Hull');
  }
  return names;
}

/** Missile / rocket: nose = the slimmer end (fins + nozzle bulk up the tail),
 *  fins = small flat radially-offset plates, body sections named by station. */
function classifyMissileParts(partInfo, size, center) {
  if (partInfo.length < 2) return null;
  const dims = [size.x, size.y, size.z];
  const axis = dims.indexOf(Math.max(...dims)); // may be Y (standing missile)
  const ms = partMetrics(partInfo, size, center, axis);
  let tip = 0;
  let tail = 0;
  for (const x of ms) {
    if (x.a < 0.33) tip += x.v;
    else if (x.a > 0.67) tail += x.v;
  }
  const noseAtMin = tip <= tail;
  const maxV = Math.max(...ms.map((x) => x.v));
  const names = new Map();
  for (const x of ms) {
    const a = noseAtMin ? x.a : 1 - x.a; // 0 = nose, 1 = tail
    const offAxis = Math.abs(x.latRel) > 0.3 ||
      (axis !== 1 && (x.yRel < 0.3 || x.yRel > 0.7));
    let name;
    if (x.flat && x.v <= 0.06 && offAxis) name = a >= 0.55 ? 'Tail Fin' : 'Canard Fin';
    else if (a <= 0.14 && x.v <= 0.18) name = 'Nose Cone';
    else if (a >= 0.9 && x.v <= 0.06) name = 'Rocket Nozzle';
    else if (x.v === maxV) name = 'Airframe / Motor Casing';
    else if (a < 0.35) name = 'Guidance Section';
    else if (a < 0.62) name = 'Warhead Section';
    else name = 'Propulsion Section';
    names.set(x.p.node, name);
  }
  return names;
}

/** Towed artillery: barrel = most elongated elevated tube, breech at its
 *  rear, wheels = mirrored side disks, trails = low rear beams. */
function classifyArtilleryParts(partInfo, size, center, axisIndex) {
  if (partInfo.length < 2) return null;
  const ms = partMetrics(partInfo, size, center, axisIndex);
  let front = 0;
  let rear = 0;
  for (const x of ms) {
    if (x.a < 0.33) front += x.v;
    else if (x.a > 0.67) rear += x.v;
  }
  const muzzleAtMin = front <= rear; // carriage/trails bulk up the rear
  const maxV = Math.max(...ms.map((x) => x.v));
  const names = new Map();
  for (const x of ms) {
    const a = muzzleAtMin ? x.a : 1 - x.a; // 0 = muzzle, 1 = rear
    const s = sideTag(x);
    const wheelish = Math.abs(x.latRel) > 0.3 && x.yRel < 0.6 &&
      x.latExt < 0.5 * x.maxDim && x.v <= 0.15 && x.elong < 2;
    let name;
    if (a <= 0.1 && x.v <= 0.03) name = 'Muzzle Brake';
    else if (x.elong >= 3 && x.yRel >= 0.35 && x.v <= 0.4) name = 'Gun Barrel';
    else if (wheelish) name = `Wheel${s}`;
    else if (a >= 0.62 && x.yRel >= 0.35 && x.v <= 0.15 && x.elong < 2.2 && !x.flat) name = 'Breech Assembly';
    else if (a >= 0.55 && x.yRel < 0.4 && x.elong >= 1.8) name = `Trail${s}`;
    else if (x.flat && x.yRel >= 0.35 && x.axExt < 0.3 * x.maxDim) name = 'Gun Shield';
    else if (x.v === maxV) name = 'Carriage';
    else if (x.elong >= 2.2 && x.yRel >= 0.4) name = 'Recoil Cylinder';
    else name = 'Carriage Section';
    names.set(x.p.node, name);
  }
  // A gun must have a barrel: when the strict rule missed (travel-config
  // barrels sit angled, so axis elongation understates them), the most
  // slender unnamed carriage piece by raw bbox proportions is the barrel.
  if (![...names.values()].includes('Gun Barrel')) {
    const overall = Math.max(size.x, size.y, size.z);
    let best = null;
    let bestS = 0;
    for (const x of ms) {
      if (names.get(x.p.node) !== 'Carriage Section') continue;
      const d = [x.p.sizes.x, x.p.sizes.y, x.p.sizes.z].sort((a, b) => b - a);
      const slender = d[0] / Math.max(d[1], 1e-6);
      if (slender >= 2 && x.maxDim >= 0.3 * overall && x.v <= 0.4 &&
          slender > bestS) {
        best = x;
        bestS = slender;
      }
    }
    if (best) names.set(best.p.node, 'Gun Barrel');
  }
  return names;
}

/** Mortar: tube = dominant slender body, base plate = low flat plate,
 *  bipod = slender low legs. Mortars sit steeply angled, so the assembly
 *  long-axis logic of the howitzer classifier does not apply. */
function classifyMortarParts(partInfo, size, center, axisIndex) {
  if (partInfo.length < 2) return null;
  const ms = partMetrics(partInfo, size, center, axisIndex);
  const maxV = Math.max(...ms.map((x) => x.v));
  const names = new Map();
  for (const x of ms) {
    const slender = x.maxDim / Math.max(x.minDim, 1e-6) >= 3;
    let name;
    if (x.flat && x.yRel < 0.35 && x.v >= 0.04) name = 'Base Plate';
    else if (x.v === maxV) name = 'Mortar Tube';
    else if (x.yRel > 0.6 && x.v < 0.05 && !slender) name = 'Sight Unit';
    else if (slender && x.yRel < 0.65) name = 'Bipod Leg';
    else if (slender) name = 'Tube Section';
    else name = 'Mount Structure';
    names.set(x.p.node, name);
  }
  return names;
}

/** Aircraft: fuselage = largest elongated mass, wings = flat lateral panels,
 *  stabilizers cluster at the tail (found via the tallest small tail part). */
function classifyAircraftParts(partInfo, size, center, axisIndex) {
  if (partInfo.length < 2) return null;
  const ms = partMetrics(partInfo, size, center, axisIndex);
  const maxV = Math.max(...ms.map((x) => x.v));
  // Tail = the end where the vertical stabilizer (tallest small part) sits
  let tailAtMax = true;
  let bestTop = -1;
  for (const x of ms) {
    if (x.v > 0.12) continue;
    if ((x.a < 0.3 || x.a > 0.7) && x.yRel > bestTop) {
      bestTop = x.yRel;
      tailAtMax = x.a > 0.5;
    }
  }
  const latAxis = axisIndex === 1 ? (size.x >= size.z ? 0 : 2)
    : (axisIndex === 0 ? 2 : 0);
  const latFull = Math.max(size.getComponent(latAxis), 1e-6);
  const long = Math.max(size.getComponent(axisIndex), 1e-6);
  const names = new Map();
  for (const x of ms) {
    const a = tailAtMax ? x.a : 1 - x.a; // 0 = nose, 1 = tail
    const s = sideTag(x);
    let name;
    if (x.v === maxV && x.elong >= 1.2) name = 'Fuselage';
    else if (Math.abs(x.latRel) > 0.3 && x.flat && a < 0.72 && x.v <= 0.3) name = `Wing${s}`;
    else if (a >= 0.72 && x.flat && Math.abs(x.latRel) > 0.15) name = `Horizontal Stabilizer${s}`;
    else if (a >= 0.72 && x.yRel > 0.55) name = 'Vertical Stabilizer';
    // Rotor disc: flat, high, and spans BOTH axes about equally (a wing is
    // far wider than it is long, so it never trips this)
    else if (x.yRel >= 0.55 && x.flat && x.axExt >= 0.45 * long &&
      x.latExt >= 0.45 * latFull &&
      (x.axExt / long) / Math.max(x.latExt / latFull, 1e-6) >= 0.6 &&
      (x.axExt / long) / Math.max(x.latExt / latFull, 1e-6) <= 1.7) name = 'Main Rotor';
    // Both wings modeled as one centered piece: flat + spans most of the span
    else if (x.flat && x.latExt >= 0.55 * latFull && x.v <= 0.35) name = 'Wing Assembly';
    else if (x.yRel < 0.3 && x.v <= 0.05) name = 'Landing Gear';
    else if (x.yRel > 0.6 && a >= 0.15 && a <= 0.55 && x.v <= 0.06) name = 'Canopy';
    else if (x.elong >= 1.8 && x.v <= 0.2) name = `Engine Nacelle${s}`;
    else name = 'Fuselage Section';
    names.set(x.p.node, name);
  }
  return names;
}

/** Warship: hull = largest low mass, superstructure above deck, masts on top. */
function classifyShipParts(partInfo, size, center, axisIndex) {
  if (partInfo.length < 2) return null;
  const ms = partMetrics(partInfo, size, center, axisIndex);
  const maxV = Math.max(...ms.map((x) => x.v));
  const names = new Map();
  for (const x of ms) {
    let name;
    if (x.v === maxV && x.yRel <= 0.6) name = 'Hull';
    else if (x.yRel > 0.85 && x.p.sizes.y === x.maxDim) name = 'Radar / Sensor Mast';
    else if (x.yRel > 0.55 && x.v >= 0.04) name = 'Superstructure';
    else if (x.yRel > 0.55 && x.elong >= 1.5) name = 'Deck Gun';
    else if (x.yRel > 0.55) name = 'Deck Structure';
    else name = 'Hull Section';
    names.set(x.p.node, name);
  }
  return names;
}

const GEO_CLASSIFIERS = {
  firearm: classifyFirearmParts, // keeps its own firearm-shape gate
  tank: classifyTankParts,
  missile: classifyMissileParts,
  artillery: classifyArtilleryParts,
  mortar: classifyMortarParts,
  aircraft: classifyAircraftParts,
  ship: classifyShipParts,
};

const LABEL_JUNK = new Set(['default', 'defaults', 'low', 'high', 'poly', 'lp',
  'hp', 'mesh', 'object', 'material', 'part', 'final', 'new', 'main',
  'game', 'ready', 'the', 'a', 'model', 'obj', 'fbx', 'blend', 'export',
  'vehicle', 'bone', 'root', 'armature', 'rig', 'dummy', 'helper', 'ex',
  'geo', 'grp', 'ctrl', 'node', 'lambert', 'phong', 'blinn', 'sg',
  'shader', 'standard', 'surface', 'mat']);
// Rig/export prefixes get glued onto real words ("vehicleex") — treat any
// word that STARTS with a longer junk word as junk too.
const isJunkWord = (w) => {
  const lw = w.toLowerCase();
  if (LABEL_JUNK.has(lw)) return true;
  for (const j of LABEL_JUNK) {
    if (j.length >= 4 && lw.startsWith(j)) return true;
  }
  return false;
};
// Sketchfab's optimizer glues its own suffixes onto node names verbatim
// ("Boeing KC-46_objcleaner.material.merger.gles") — strip them outright.
const PIPELINE_JUNK_RE = /(objcleanermaterialmerger(?:gles)?|materialmerger|objcleaner)/gi;
// Names that carry no meaning at all (our own Segment/Section splits included)
const MEANINGLESS_RE = /^(segment|section|part|group|piece|component|element)\s*\d*$/i;
/** True when a label contains nothing but junk words and indices —
 *  it should be handed to the geometry identifier instead. */
function isJunkOnlyLabel(raw) {
  const words = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .split(/\s+/).filter((w) => w && !isJunkWord(w) && !/^\d+$/.test(w));
  return words.length === 0;
}

/** Map an artist's part name onto engineering nomenclature, keeping short
 *  distinguishing qualifiers ("Handguard DMR" -> "Handguard (DMR)"). */
function canonicalizeLabel(raw, aliases = FIREARM_ALIASES) {
  // Split camelCase ("SlideHolder" -> "Slide Holder") and glued digit
  // suffixes ("Wheel15" -> "Wheel 15"), drop modeling-junk words ("low",
  // "poly", "material") and trailing export indices ("0 1").
  const label = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .split(/\s+/).filter((w) => w && !isJunkWord(w))
    .join(' ').replace(/(\s+\d+)+$/, '').trim() || raw.trim();
  for (const [canon, rx] of aliases) {
    if (!rx.test(label)) continue;
    const leftover = label.replace(rx, ' ').split(/\s+/).map((w) =>
      w.replace(/[^A-Za-z0-9]/g, '')).filter((w) =>
      w.length >= 3 && !isJunkWord(w) && !/^\d+$/.test(w) &&
      !canon.toLowerCase().includes(w.toLowerCase()));
    return leftover.length && leftover.length <= 2
      ? `${canon} (${leftover.join(' ')})` : canon;
  }
  // Artists glue variant letters onto part words ("hullb", "smokec") which
  // hides them from the \b-anchored aliases — retry with one trailing letter
  // dropped from each longer word.
  const alt = label.split(/\s+/)
    .map((w) => (w.length >= 5 ? w.slice(0, -1) : w)).join(' ');
  for (const [canon, rx] of aliases) {
    if (rx.test(alt)) return canon;
  }
  // Keep the artist's own name, title-cased
  return label.split(/\s+/).map((w) =>
    w.length > 2 && w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w
  ).join(' ');
}

/**
 * Identify generically-named parts of a firearm-shaped assembly from pure
 * geometry — normalized position and proportions inside the weapon decide
 * the name (front thin long part = barrel, bottom tall box = magazine...).
 * Returns Map(node -> name), or null when the assembly isn't firearm-like
 * (vehicles/missiles/aircraft route to their own classifiers instead).
 */
function classifyFirearmParts(partInfo, size, center, axisIndex) {
  const long = size.getComponent(axisIndex);
  const latIndex = axisIndex === 0 ? 2 : 0;
  if (!(long >= 2.4 * size.y && long >= 3.2 * size.getComponent(latIndex))) return null;
  if (partInfo.length < 2) return null;

  const vol = (p) => p.sizes.x * p.sizes.y * p.sizes.z;
  const axMin = center.getComponent(axisIndex) - long / 2;
  const frac = (p) => (p.center.getComponent(axisIndex) - axMin) / Math.max(long, 1e-6);
  // Muzzle end = the end third with less bulk (stock/grip end is bulkier)
  let front = 0;
  let rear = 0;
  for (const p of partInfo) {
    const a = frac(p);
    if (a < 0.33) front += vol(p);
    else if (a > 0.67) rear += vol(p);
  }
  const muzzleAtMin = front <= rear;
  const totalVol = partInfo.reduce((s, p) => s + vol(p), 0) || 1e-9;
  const maxVol = Math.max(...partInfo.map(vol));
  const yBottom = center.y - size.y / 2;

  const names = new Map();
  for (const p of partInfo) {
    const a = muzzleAtMin ? frac(p) : 1 - frac(p); // 0 = muzzle, 1 = butt
    const v = vol(p) / totalVol;
    const other = Math.max(p.sizes.y, p.sizes.getComponent(latIndex));
    const elong = p.extent / Math.max(other, 1e-6);
    const yRel = (p.center.y - yBottom) / Math.max(size.y, 1e-6);
    const tall = p.sizes.y > p.extent * 1.2;
    let name;
    // v caps matter: a real barrel/gas tube is never most of the weapon's
    // volume — without them the big receiver+barrel body wins those names.
    if (a < 0.12 && v < 0.03) name = 'Muzzle Device';
    else if (elong >= 2.5 && a < 0.55 && yRel > 0.35 && v <= 0.35) name = 'Barrel Assembly';
    else if (tall && yRel < 0.4 && a >= 0.3 && a <= 0.72) name = 'Magazine';
    else if (a > 0.78) name = 'Buttstock';
    else if (v < 0.02 && yRel > 0.72 && p.extent < long * 0.12) name = a < 0.4 ? 'Front Sight' : 'Rear Sight';
    else if (vol(p) === maxVol) name = 'Receiver';
    else if (tall && yRel < 0.4 && a > 0.55) name = 'Grip Assembly';
    else if (elong >= 2.5 && yRel > 0.55 && p.extent >= long * 0.12 && p.extent <= long * 0.5) name = 'Gas Tube';
    else if (a < 0.45) name = 'Handguard Section';
    else name = 'Receiver Section';
    names.set(p.node, name);
  }
  return names;
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

/** Build a new Mesh from a subset of `mesh`'s triangles (indices into its
 *  triangle list), preserving all vertex attributes and the material. */
function trisToMesh(mesh, tris) {
  const geom = mesh.geometry;
  const index = geom.index ? geom.index.array : null;
  const vert = (t, c) => (index ? index[t * 3 + c] : t * 3 + c);
  const map = new Map();
  const newIndex = new Uint32Array(tris.length * 3);
  let n = 0;
  for (let i = 0; i < tris.length; i++) {
    for (let c = 0; c < 3; c++) {
      const v = vert(tris[i], c);
      let nv = map.get(v);
      if (nv === undefined) { nv = map.size; map.set(v, nv); }
      newIndex[n++] = nv;
    }
  }
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geom.attributes)) {
    const item = attr.itemSize;
    const arr = new attr.array.constructor(map.size * item);
    for (const [oldV, newV] of map) {
      for (let k = 0; k < item; k++) arr[newV * item + k] = attr.array[oldV * item + k];
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, item, attr.normalized));
  }
  g.setIndex(new THREE.BufferAttribute(newIndex, 1));
  const m = new THREE.Mesh(g, mesh.material);
  m.position.copy(mesh.position);
  m.quaternion.copy(mesh.quaternion);
  m.scale.copy(mesh.scale);
  return m;
}

/**
 * Split a single merged mesh into its connected shells so a one-mesh model
 * (e.g. a missile exported as one geometry) can still disassemble.
 * Vertices are welded by quantized position first so UV/normal seams do not
 * count as breaks. Returns an array of new Meshes (sharing the material) or
 * null when the mesh is genuinely one piece / too heavy to analyze.
 */
function splitMeshByComponents(mesh, maxParts = 16) {
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  if (!pos || pos.count === 0 || pos.count > 400000) return null;
  const index = geom.index ? geom.index.array : null;
  const triCount = Math.floor((index ? index.length : pos.count) / 3);
  if (triCount < 12) return null;

  // Weld vertices by quantized position
  const keyOf = new Map();
  const weld = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    let id = keyOf.get(k);
    if (id === undefined) { id = keyOf.size; keyOf.set(k, id); }
    weld[i] = id;
  }

  // Union-find over welded vertices, joined per triangle
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

  // Group triangles by component
  const byRoot = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(weld[vert(t, 0)]);
    let arr = byRoot.get(r);
    if (!arr) { arr = []; byRoot.set(r, arr); }
    arr.push(t);
  }
  if (byRoot.size < 2) return null;

  let comps = [...byRoot.values()].sort((a, b) => b.length - a.length);
  // Fold dust (< 0.5% of triangles) into the largest shell, cap part count
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

  return comps.map((tris) => trisToMesh(mesh, tris));
}

/**
 * Last-resort disassembly for a mesh that is genuinely ONE connected piece
 * (or too heavy for the connectivity analysis): cut it into bands along its
 * longest axis by binning triangles on their centroid — a CAD-style section
 * cut. Cross-sections are left open, which reads fine once separated.
 * Guarantees every model gets an exploding view. Returns Meshes or null.
 */
function sliceMeshByAxis(mesh, slices = 6) {
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  if (!pos || pos.count === 0) return null;
  const index = geom.index ? geom.index.array : null;
  const triCount = Math.floor((index ? index.length : pos.count) / 3);
  if (triCount < slices * 4) return null;

  geom.computeBoundingBox();
  const size = new THREE.Vector3();
  geom.boundingBox.getSize(size);
  // Pick the longest axis in WORLD terms (local extent × world scale)
  const ws = new THREE.Vector3();
  mesh.getWorldScale(ws);
  const ext = new THREE.Vector3(
    size.x * Math.abs(ws.x), size.y * Math.abs(ws.y), size.z * Math.abs(ws.z));
  const axis = ext.x >= ext.y && ext.x >= ext.z ? 'x' : ext.y >= ext.z ? 'y' : 'z';
  const min = geom.boundingBox.min[axis];
  const span = Math.max(size[axis], 1e-6);

  const getC = axis === 'x' ? (i) => pos.getX(i)
    : axis === 'y' ? (i) => pos.getY(i) : (i) => pos.getZ(i);
  const vert = (t, c) => (index ? index[t * 3 + c] : t * 3 + c);
  const bins = Array.from({ length: slices }, () => []);
  for (let t = 0; t < triCount; t++) {
    const c = (getC(vert(t, 0)) + getC(vert(t, 1)) + getC(vert(t, 2))) / 3;
    const b = Math.min(slices - 1, Math.max(0, Math.floor(((c - min) / span) * slices)));
    bins[b].push(t);
  }
  const groups = bins.filter((b) => b.length > 0);
  if (groups.length < 2) return null;
  return groups.map((tris) => trisToMesh(mesh, tris));
}

function AssemblyModel({ url, explodeFactor, components, intelFor, onPartsInfo,
                         selected, onSelect, hovered, onHover, assetName = '' }) {
  const { scene, parser } = useGLTF(url);
  const [targets, setTargets] = useState([]);

  useEffect(() => {
    if (!scene) return;

    // Recover glTF meshDef names that GLTFLoader discards when a generic
    // NODE name ("Object_339") overrides them — artist kits often keep the
    // real part names ("Front Sight", "Gas Tube") only on the mesh defs.
    const json = parser?.json;
    if (json?.meshes) {
      scene.traverse((c) => {
        if (!c.isMesh || (c.name && !isGenericName(c.name))) return;
        const assoc = parser.associations?.get(c);
        let meshIndex = assoc?.meshes;
        if (meshIndex == null && assoc?.nodes != null) {
          meshIndex = json.nodes?.[assoc.nodes]?.mesh;
        }
        const nm = meshIndex != null ? json.meshes[meshIndex]?.name : '';
        if (nm && !isGenericName(nm)) c.userData.realName = nm;
      });
    }

    // --- Auto-scale and ground the whole assembly ---
    scene.position.set(0, 0, 0);
    scene.scale.set(1, 1, 1);
    scene.rotation.set(0, 0, 0);
    scene.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 6 / maxDim : 1;
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);
    box.setFromObject(scene);
    const center = new THREE.Vector3();
    box.getCenter(center);
    scene.position.set(-center.x, -box.min.y, -center.z);
    scene.updateMatrixWorld(true);
    box.setFromObject(scene);
    box.getCenter(center);
    box.getSize(size);

    // --- Pass 1: strict pipeline hierarchy ---
    const matched = new Set();
    const hasMatchedAncestor = (obj) => {
      for (let p = obj.parent; p; p = p.parent) if (matched.has(p)) return true;
      return false;
    };
    let shellNode = null;
    let partNodes = []; // { node, slot|null }
    scene.traverse((child) => {
      const name = child.name || '';
      if (hasMatchedAncestor(child)) return;
      if (name === SHELL_NAME || name.startsWith(SHELL_NAME)) {
        matched.add(child);
        shellNode = child;
      } else if (name.startsWith(PART_PREFIX)) {
        matched.add(child);
        partNodes.push({ node: child, slot: parseInt(name.replace(PART_PREFIX, ''), 10) || 1 });
      }
    });
    const strictMode = !!shellNode && partNodes.length > 0;

    // --- Pass 2 (generic GLB): geometry-bearing children of the container ---
    if (!strictMode) {
      shellNode = null;
      partNodes = [];
      const hasGeometry = (o) => {
        let found = false;
        o.traverse((x) => { if (x.isMesh) found = true; });
        return found;
      };
      // Descend through single-child wrapper chains (Sketchfab_model > root > ...)
      let container = scene;
      for (let depth = 0; depth < 12; depth++) {
        const kids = container.children.filter(hasGeometry);
        if (kids.length === 1 && !kids[0].isMesh) { container = kids[0]; continue; }
        break;
      }
      let kids = container.children.filter(hasGeometry);
      if (kids.length === 0) kids = [container];

      // Assembled models often hide their real parts one level deeper
      // (Body > [receiver, rails, ...]). Expand the coarsest groups until
      // the split is meaningful. A Mesh that also parents other meshes (an
      // FBX habit) gets its children detached so they explode on their own.
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
            bestIdx = i;
            bestSub = sub;
          }
        });
        if (bestIdx < 0) break;
        const dk = descendWrappers(kids[bestIdx]);
        if (dk.isMesh) {
          // attach() rewrites local TRS so world transforms are preserved
          for (const child of bestSub) dk.parent.attach(child);
          kids.splice(bestIdx, 1, dk, ...bestSub);
        } else {
          kids.splice(bestIdx, 1, ...bestSub);
        }
      }

      // Merged single-mesh model: split into connected shells so the
      // disassembly still reads (nose / fins / body separate at the seams).
      // When the mesh is one solid connected piece, fall back to axis
      // slicing so EVERY model still gets an exploding view.
      if (kids.length === 1) {
        const meshes = [];
        kids[0].traverse((x) => { if (x.isMesh) meshes.push(x); });
        if (meshes.length === 1) {
          let pieces = splitMeshByComponents(meshes[0]);
          let sectioned = false;
          if (!pieces || pieces.length < 2) {
            pieces = sliceMeshByAxis(meshes[0]);
            sectioned = true;
          }
          if (pieces && pieces.length > 1) {
            const holder = meshes[0].parent;
            holder.remove(meshes[0]);
            pieces.forEach((p, i) => {
              p.name = sectioned ? `Section_${i + 1}` : `Segment_${i + 1}`;
              holder.add(p);
            });
            kids = pieces;
          }
        }
      }

      // Fetched/pasted models (never library assets — their researched intel
      // is keyed to the stock detection) get a RICHER split: big merged
      // chunks break into their connected shells so tanks/artillery/missiles
      // expose barrel, carriage, wheels... instead of a few fused lumps.
      if (/\/uploads\//.test(url) && kids.length > 1 && kids.length < 10) {
        const singles = kids
          .map((k) => {
            const meshes = [];
            k.traverse((x) => { if (x.isMesh) meshes.push(x); });
            return { k, mesh: meshes.length === 1 ? meshes[0] : null };
          })
          .filter((e) => e.mesh)
          .sort((a, b) => countFaces(b.k) - countFaces(a.k));
        let seg = 0;
        for (const { k, mesh } of singles) {
          if (kids.length >= 14) break;
          const pieces = splitMeshByComponents(mesh, Math.min(10, 15 - kids.length));
          if (!pieces || pieces.length < 2) continue;
          const holder = mesh.parent;
          holder.remove(mesh);
          pieces.forEach((p) => { p.name = `Segment_${++seg}`; holder.add(p); });
          kids.splice(kids.indexOf(k), 1, ...pieces);
        }
        scene.updateMatrixWorld(true);
      }

      // Hundreds of loose fittings (ships, detailed vehicles) would drown
      // the presentation and the GPU: cluster them into spatially coherent
      // sections on a coarse 3D grid.
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
          group.attach(k); // preserves each node's world transform
        }
        kids = [...cells.values()];
      }

      scene.updateMatrixWorld(true);
      partNodes = kids.map((node) => ({ node, slot: null }));
    }

    const axisIndex = size.x >= size.z ? 0 : 2;
    const axisDir = new THREE.Vector3();
    axisDir.setComponent(axisIndex, 1);
    const axisLength = size.getComponent(axisIndex);

    // Measure every part
    const partInfo = partNodes.map(({ node, slot }) => {
      const b = new THREE.Box3().setFromObject(node);
      const c = new THREE.Vector3();
      const s = new THREE.Vector3();
      b.getCenter(c);
      b.getSize(s);
      return { node, slot, center: c, sizes: s, extent: s.getComponent(axisIndex) };
    });
    partInfo.sort((a, b) => a.center.getComponent(axisIndex) - b.center.getComponent(axisIndex));

    const newTargets = [];

    if (strictMode) {
      // ---- Field-strip explode: shell up, parts to evenly spaced slots ----
      const maxExtent = Math.max(0.6, ...partInfo.map((p) => p.extent));
      const spacing = Math.max(maxExtent * 1.45, axisLength * 0.26);
      const worldOffset = new THREE.Vector3(0, size.y * 1.15 + 1.6, 0);
      newTargets.push({
        node: shellNode, key: SHELL_NAME, isShell: true,
        rest: shellNode.position.clone(),
        offset: worldOffsetToParentLocal(shellNode, worldOffset),
        order: 0, slot: 0,
      });
      partInfo.forEach((info, i) => {
        const slotCoord = (i - (partInfo.length - 1) / 2) * spacing;
        const wo = axisDir.clone().multiplyScalar(
          slotCoord + center.getComponent(axisIndex) - info.center.getComponent(axisIndex));
        newTargets.push({
          node: info.node, key: `${PART_PREFIX}${info.slot}`, isShell: false,
          rest: info.node.position.clone(),
          offset: worldOffsetToParentLocal(info.node, wo),
          order: i + 1, slot: info.slot,
          info,
        });
      });
    } else {
      // ---- Generic explode: radial spread for kits, grid for clusters ----
      const centersBox = new THREE.Box3();
      partInfo.forEach((p) => centersBox.expandByPoint(p.center));
      const centersSize = new THREE.Vector3();
      centersBox.getSize(centersSize);
      const spreadRatio = Math.max(centersSize.x, centersSize.y, centersSize.z) /
        Math.max(size.x, size.y, size.z, 1e-6);
      const kitLayout = spreadRatio > 0.35; // authored knolling layout

      partInfo.forEach((info, i) => {
        let wo;
        if (kitLayout) {
          // Scale the authored layout outward from the assembly center, plus
          // a normalized push so parts sitting near the center also separate.
          const radial = info.center.clone().sub(center);
          const dir = radial.clone();
          if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0); else dir.normalize();
          wo = radial.multiplyScalar(0.9).add(
            dir.multiplyScalar(Math.max(size.x, size.y, size.z) * 0.16));
        } else {
          // Clustered model: fan out into a grid in the axis/vertical plane
          const perRow = Math.ceil(Math.sqrt(partInfo.length * 1.8));
          const row = Math.floor(i / perRow);
          const rows = Math.ceil(partInfo.length / perRow);
          const col = i % perRow;
          const spacingX = Math.max(1.0, ...partInfo.map((p) => p.extent)) * 1.35;
          const spacingY = Math.max(0.9, ...partInfo.map((p) => p.sizes.y)) * 1.4;
          const target = new THREE.Vector3();
          target.setComponent(axisIndex, (col - (perRow - 1) / 2) * spacingX + center.getComponent(axisIndex));
          target.y = center.y + (row - (rows - 1) / 2) * spacingY;
          target.setComponent(axisIndex === 0 ? 2 : 0, center.getComponent(axisIndex === 0 ? 2 : 0));
          wo = target.sub(info.center);
        }
        newTargets.push({
          node: info.node, key: `part_${i}`, isShell: false,
          rest: info.node.position.clone(),
          offset: worldOffsetToParentLocal(info.node, wo),
          order: i, slot: null,
          info,
        });
      });
    }

    // --- Deterministic display names (no AI): the weapon CLASS (from the
    // asset name, else pure shape) picks the nomenclature dictionary and the
    // geometry identifier — tanks, missiles, artillery, aircraft and ships
    // each get their own real engineering part names, not "Section N" ---
    let wclass = weaponClassFromName(assetName) ||
      weaponClassFromShape(size) || 'firearm';
    // "SCUD Missile LAUNCHER" that isn't missile-shaped is the carrier
    // vehicle — name it like one.
    if (wclass === 'missile' && weaponClassFromShape(size) !== 'missile' &&
        /\b(launcher|tel\b|truck|vehicle|carrier|system)\b/i.test(assetName || '')) {
      wclass = 'tank';
    }
    const aliases = ALIASES_BY_CLASS[wclass] || FIREARM_ALIASES;
    const classify = GEO_CLASSIFIERS[wclass] || classifyFirearmParts;
    const geoNames = strictMode ? null
      : classify(partInfo, size, center, axisIndex);
    // Pre-pass: one non-nomenclature name stamped across most parts is a
    // watermark/scene name ("desirefxme"), not per-part information — those
    // parts go to the geometry identifier instead.
    const canonCounts = new Map();
    let nParts = 0;
    for (const t of newTargets) {
      if (t.isShell) continue;
      t.rawLabel = partLabel(t.node, aliases)
        .replace(PIPELINE_JUNK_RE, ' ').replace(/\s+/g, ' ').trim();
      t.canonLabel = canonicalizeLabel(t.rawLabel, aliases);
      const k = t.canonLabel.toLowerCase();
      canonCounts.set(k, (canonCounts.get(k) || 0) + 1);
      nParts += 1;
    }
    const aliasCanons = new Set(aliases.map(([c]) => c));
    // A label whose every word is lifted from the asset's own name ("Boeing
    // KC 46 Pegasus" on the KC-46A card) identifies the model, not the part.
    const assetNorm = (assetName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const isNameEcho = (s) => {
      if (!assetNorm) return false;
      const words = s.toLowerCase().split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 2 && !/^\d+$/.test(w)); // "02" indices aside
      // 75%+ of the words lifted from the asset name is still an echo —
      // designation variants ("KF-21A" vs "KF-21") shouldn't defeat it.
      const hit = words.filter((w) => assetNorm.includes(w)).length;
      return words.length > 0 && hit >= Math.ceil(words.length * 0.75);
    };
    for (const t of newTargets) {
      if (t.isShell) {
        t.rawLabel = 'Outer Shell';
        t.displayLabel = 'Outer Shell';
        continue;
      }
      const canon = t.canonLabel;
      const dup = canonCounts.get(canon.toLowerCase()) || 0;
      const watermark = dup >= 3 && dup >= 0.6 * nParts &&
        !aliasCanons.has(canon.replace(/\s*\(.*\)$/, ''));
      const meaningless = MEANINGLESS_RE.test(t.rawLabel) ||
        isGenericName(t.rawLabel.replace(/\s+/g, '')) ||
        isJunkOnlyLabel(t.rawLabel) || watermark ||
        (isNameEcho(t.rawLabel) &&
          !aliasCanons.has(canon.replace(/\s*\(.*\)$/, '')));
      if (meaningless && geoNames?.has(t.node)) {
        t.displayLabel = geoNames.get(t.node);
        t.inferred = true;
      } else {
        t.displayLabel = canon;
      }
    }
    // Duplicates get numbered ("Magazine", "Magazine 2") so callouts,
    // spec rows and isolation banners stay unambiguous.
    const labelCounts = new Map();
    for (const t of newTargets) {
      if (t.isShell) continue;
      const n = (labelCounts.get(t.displayLabel) || 0) + 1;
      labelCounts.set(t.displayLabel, n);
      if (n > 1) t.displayLabel = `${t.displayLabel} ${n}`;
    }

    // Label anchors + per-part material cloning (isolate/highlight safety)
    for (const t of newTargets) {
      const b = new THREE.Box3().setFromObject(t.node);
      const c = new THREE.Vector3();
      b.getCenter(c);
      t.labelAnchor = t.node.worldToLocal(c.clone());
      t.node.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material = Array.isArray(child.material)
            ? child.material.map((m) => m.clone())
            : child.material.clone();
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }

    setTargets(newTargets);
    onPartsInfo?.(newTargets.map((t, i) => ({
      key: t.key,
      isShell: t.isShell,
      slot: t.slot,
      index: i,
      label: t.displayLabel,
      rawLabel: t.rawLabel,
      inferred: !!t.inferred,
      faces: countFaces(t.node),
      dims: t.info ? [t.info.sizes.x, t.info.sizes.y, t.info.sizes.z] : null,
    })));
  }, [scene, parser, onPartsInfo, assetName]);

  // --- Drive positions from the global factor with per-part cascade ---
  useEffect(() => {
    for (const t of targets) {
      const p = cascadeProgress(explodeFactor, t.order, targets.length);
      t.node.position.set(
        t.rest.x + t.offset.x * p,
        t.rest.y + t.offset.y * p,
        t.rest.z + t.offset.z * p,
      );
    }
  }, [explodeFactor, targets]);

  // --- Hover highlight + click-to-isolate material states ---
  useEffect(() => {
    for (const t of targets) {
      const isHovered = hovered === t.key;
      const isDimmed = selected && selected !== t.key;
      t.node.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (m.emissive) {
            m.emissive.copy(isHovered ? ACCENT : new THREE.Color(0x000000));
            m.emissiveIntensity = isHovered ? 0.35 : 0;
          }
          m.transparent = isDimmed;
          m.opacity = isDimmed ? 0.1 : 1;
          m.depthWrite = !isDimmed;
        }
      });
    }
  }, [hovered, selected, targets]);

  const findTargetKey = useCallback((object) => {
    for (let o = object; o; o = o.parent) {
      const hit = targets.find((t) => t.node === o);
      if (hit) return hit.key;
    }
    return null;
  }, [targets]);

  const manyParts = targets.length > 8;

  return (
    <>
      <primitive
        object={scene}
        onPointerOver={(e) => {
          e.stopPropagation();
          const key = findTargetKey(e.object);
          if (key) {
            onHover?.(key);
            document.body.style.cursor = 'pointer';
          }
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          onHover?.(null);
          document.body.style.cursor = 'auto';
        }}
        onClick={(e) => {
          e.stopPropagation();
          const key = findTargetKey(e.object);
          if (key) onSelect?.(key === selected ? null : key);
        }}
      />

      {/* Balloon callouts. With many parts only the active one is labeled
          to keep the presentation clean. */}
      {targets.map((t, i) => {
        const p = cascadeProgress(explodeFactor, t.order, targets.length);
        const active = hovered === t.key || selected === t.key;
        const visible = manyParts ? active : (p > 0.55 || active);
        const comp = t.isShell ? null
          : (t.slot != null ? components[t.slot - 1] : intelFor?.(t.rawLabel, t.key));
        const label = t.isShell ? 'Outer Shell' : (comp?.part_name || t.displayLabel);
        const tier = comp?.risk_tier?.toUpperCase();
        const number = t.isShell ? 'S' : (t.slot ?? i + 1);
        return createPortal(
          <group position={t.labelAnchor || [0, 0, 0]}>
            <Html
              center
              distanceFactor={11}
              zIndexRange={[10, 0]}
              style={{
                pointerEvents: 'none',
                opacity: visible ? 1 : 0,
                transition: 'opacity 0.3s ease',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: 'translateY(-50%)' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  background: 'rgba(255,255,255,0.95)',
                  border: '1px solid #c9c9c9', borderRadius: 8,
                  padding: '5px 10px', whiteSpace: 'nowrap',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.10)',
                }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: t.isShell ? '#222' : '#0066ff', color: '#fff',
                    fontFamily: 'ui-monospace, monospace', fontSize: 10, fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {number}
                  </span>
                  <span style={{
                    fontFamily: 'ui-monospace, monospace', fontSize: 11,
                    letterSpacing: 0.5, color: '#1a1a1a', fontWeight: 600,
                  }}>
                    {label}
                  </span>
                  {tier && RISK_COLORS[tier] && (
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: RISK_COLORS[tier] }} title={tier} />
                  )}
                </div>
                <div style={{ width: 1, height: 34, background: '#9a9a9a' }} />
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#555', border: '1px solid #fff' }} />
              </div>
            </Html>
          </group>,
          t.node,
        );
      })}
    </>
  );
}

const fmtFaces = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export default function ExplodedAssemblyViewer({ assemblyUrl, components = [], intel = {},
                                                 assetName = '', profile = null,
                                                 onPartsDetected = null }) {
  const [explodeFactor, setExplodeFactor] = useState(0);
  const [partsInfo, setPartsInfo] = useState([]);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const animRef = useRef(null);
  const factorRef = useRef(0);
  factorRef.current = explodeFactor;

  const animateTo = useCallback((target) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const from = factorRef.current;
    if (Math.abs(target - from) < 0.001) return;
    const duration = 2400 * Math.abs(target - from) + 300;
    const startTime = performance.now();
    const step = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      setExplodeFactor(from + (target - from) * t);
      if (t < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }, []);

  const onScrub = useCallback((e) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setExplodeFactor(parseFloat(e.target.value));
  }, []);

  const stableOnPartsInfo = useCallback((info) => {
    setPartsInfo(info);
    onPartsDetected?.(info);
  }, [onPartsDetected]);
  const totalFaces = useMemo(() => partsInfo.reduce((a, p) => a + p.faces, 0), [partsInfo]);

  // Intel lookup. Library assets are researched per detected part, so their
  // intel is keyed by the exact part key (part_0, part_1...) — that always wins.
  // Sketchfab/uploaded kits are keyed by mesh name: exact label hit, else best
  // token-overlap ("Handguard M4" matches "Handguard_M4" or "M4 Handguard").
  const intelFor = useCallback((label, partKey) => {
    if (!intel) return null;
    if (partKey && intel[partKey]) return intel[partKey];
    if (!label) return null;
    if (intel[label]) return intel[label];
    const tokens = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]+/g) || []);
    const lt = tokens(label);
    let best = null;
    let bestScore = 0;
    for (const [key, comp] of Object.entries(intel)) {
      const kt = tokens(key);
      let overlap = 0;
      for (const t of lt) if (kt.has(t)) overlap++;
      const score = overlap / Math.max(1, Math.min(lt.size, kt.size));
      if (score > bestScore) { bestScore = score; best = comp; }
    }
    return bestScore >= 0.5 ? best : null;
  }, [intel]);

  if (!assemblyUrl) return null;

  const mono = 'var(--font-mono, ui-monospace, monospace)';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        camera={{ position: [7, 4.5, 9], fov: 50, near: 0.1, far: 1000 }}
        shadows
        gl={{ antialias: true, alpha: false, toneMapping: 3, toneMappingExposure: 1.4 }}
        style={{ background: '#FFFFFF' }}
        onPointerMissed={() => setSelected(null)}
      >
        <color attach="background" args={['#FFFFFF']} />
        <Environment preset="studio" />
        <ambientLight intensity={0.6} />
        <directionalLight position={[8, 12, 8]} intensity={1.0} castShadow shadow-mapSize={[2048, 2048]} />
        <directionalLight position={[-5, 6, -5]} intensity={0.4} color="#e8eae7" />

        <Grid
          position={[0, -0.06, 0]}
          args={[30, 30]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="#e8e8e8"
          sectionSize={2}
          sectionThickness={1}
          sectionColor="#d0d0d0"
          fadeDistance={30}
          fadeStrength={1}
          infiniteGrid
        />
        <ContactShadows position={[0, -0.04, 0]} opacity={0.4} scale={22} blur={2} far={6} />

        <Suspense fallback={<Html center><div style={{ fontFamily: 'monospace', fontSize: 12 }}>Loading assembly…</div></Html>}>
          <AssemblyModel
            url={assemblyUrl}
            explodeFactor={explodeFactor}
            components={components}
            intelFor={intelFor}
            onPartsInfo={stableOnPartsInfo}
            selected={selected}
            onSelect={setSelected}
            hovered={hovered}
            onHover={setHovered}
            assetName={assetName}
          />
        </Suspense>

        <OrbitControls makeDefault enableDamping dampingFactor={0.05} minDistance={2} maxDistance={45} target={[0, 1.5, 0]} />
      </Canvas>

      {/* ---- SPEC PANEL: component sheet -------------------------------- */}
      <div style={{
        position: 'absolute', top: 16, right: 16, zIndex: 25,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8,
        maxHeight: 'calc(100% - 120px)',
      }}>
        <button
          onClick={() => setPanelOpen((o) => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 8,
            border: '1px solid var(--outline-variant, #d0d0d0)',
            background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)',
            fontFamily: mono, fontSize: 10, letterSpacing: 1.5,
            textTransform: 'uppercase', cursor: 'pointer', color: 'var(--on-surface, #222)',
          }}
          id="spec-panel-toggle"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
            {panelOpen ? 'right_panel_close' : 'list_alt'}
          </span>
          Component Sheet
        </button>

        {panelOpen && (
          <div style={{
            width: 288, overflowY: 'auto',
            background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(10px)',
            border: '1px solid var(--outline-variant, #d0d0d0)', borderRadius: 12,
            boxShadow: '0 6px 24px rgba(0,0,0,0.08)',
          }} id="spec-panel">
            {/* Title block */}
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #e4e4e4' }}>
              <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2, color: '#999', textTransform: 'uppercase' }}>
                Assembly Specification
              </div>
              <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: '#141414', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {assetName || 'Untitled Assembly'}
              </div>
              {profile?.designation && (
                <div style={{ fontFamily: mono, fontSize: 9, color: '#0066ff', marginTop: 3, lineHeight: 1.4 }}>
                  {profile.designation}
                </div>
              )}
              <div style={{ fontFamily: mono, fontSize: 9, color: '#888', marginTop: 4, letterSpacing: 1 }}>
                {partsInfo.length} COMPONENTS · {fmtFaces(totalFaces)} TRIANGLES
              </div>
              {profile?.operating_principle && (
                <div style={{ fontFamily: mono, fontSize: 9, color: '#777', marginTop: 6, lineHeight: 1.5 }}>
                  {profile.operating_principle}
                </div>
              )}
            </div>

            {/* Part rows */}
            {partsInfo.map((p) => {
              const comp = p.isShell ? null
                : (p.slot != null ? components[p.slot - 1] : intelFor(p.rawLabel || p.label, p.key));
              const label = comp?.part_name || p.label;
              const tier = comp?.risk_tier?.toUpperCase();
              const isSel = selected === p.key;
              const isHov = hovered === p.key;
              return (
                <div
                  key={p.key}
                  onMouseEnter={() => setHovered(p.key)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setSelected(isSel ? null : p.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '8px 12px', cursor: 'pointer',
                    background: isSel ? 'rgba(0,102,255,0.10)' : isHov ? 'rgba(0,0,0,0.04)' : 'transparent',
                    borderBottom: '1px solid #efefef',
                    borderLeft: isSel ? '3px solid #0066ff' : '3px solid transparent',
                  }}
                >
                  <span style={{
                    width: 20, height: 20, minWidth: 20, borderRadius: '50%',
                    background: p.isShell ? '#222' : '#0066ff', color: '#fff',
                    fontFamily: mono, fontSize: 9, fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {p.isShell ? 'S' : (p.slot ?? p.index + 1)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: mono, fontSize: 10.5, fontWeight: 600, color: '#1c1c1c',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {label}
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 8.5, color: '#999', marginTop: 1, display: 'flex', gap: 8 }}>
                      {comp?.assembly
                        ? <span style={{ color: '#0066ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{comp.assembly}</span>
                        : <span>{fmtFaces(p.faces)} tris</span>}
                      {comp?.disassembly_order > 0 && <span>strip #{comp.disassembly_order}</span>}
                      {comp?.model_source && <span>{comp.model_source}</span>}
                      {comp?.material_dependency && (
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
                          {comp.material_dependency}
                        </span>
                      )}
                      {(comp?.confidence === 'low' || (!comp && p.inferred)) &&
                        <span title="identified from geometry" style={{ color: '#c98a00' }}>inferred</span>}
                    </div>
                  </div>
                  {tier && RISK_COLORS[tier] && (
                    <span style={{
                      fontFamily: mono, fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
                      color: RISK_COLORS[tier], border: `1px solid ${RISK_COLORS[tier]}55`,
                      borderRadius: 999, padding: '2px 7px', background: `${RISK_COLORS[tier]}11`,
                    }}>
                      {tier}
                    </span>
                  )}
                </div>
              );
            })}

            {selected && (
              <div style={{ padding: '8px 12px', fontFamily: mono, fontSize: 8.5, color: '#888' }}>
                Click the highlighted row again (or empty space) to exit isolation.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- Explosion control overlay ----------------------------------- */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--outline-variant, #d0d0d0)',
          borderRadius: 12,
          padding: '12px 24px',
          zIndex: 20,
          minWidth: 340,
        }}
      >
        <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--outline, #888)' }}>
          Exploded View — {Math.round(explodeFactor * 100)}%
          {selected && (
            <span style={{ color: 'var(--primary, #0066ff)' }}>
              {' '}· {(partsInfo.find((p) => p.key === selected)?.label || selected).toUpperCase()} isolated
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, width: '100%', justifyContent: 'center' }}>
          <button
            onClick={() => animateTo(0)}
            id="btn-assemble"
            style={{
              flex: 1, padding: '8px 14px', border: '1px solid var(--outline-variant, #d0d0d0)',
              borderRadius: 8, background: 'var(--surface-container-lowest, #fff)',
              fontFamily: mono, fontSize: 10, letterSpacing: 1.5,
              textTransform: 'uppercase', cursor: 'pointer', color: 'var(--on-surface, #222)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>compress</span>
            Assemble
          </button>
          <button
            onClick={() => animateTo(1)}
            id="btn-disassemble"
            style={{
              flex: 1, padding: '8px 14px', border: 'none', borderRadius: 8,
              background: 'var(--primary, #0066ff)', color: 'var(--on-primary, #fff)',
              fontFamily: mono, fontSize: 10, letterSpacing: 1.5,
              textTransform: 'uppercase', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>open_with</span>
            Disassemble
          </button>
        </div>

        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={explodeFactor}
          onInput={onScrub}
          onChange={onScrub}
          style={{ width: '100%', accentColor: 'var(--primary, #0066ff)', cursor: 'pointer' }}
          id="explode-slider"
        />
        <div style={{ fontFamily: mono, fontSize: 9, color: 'var(--outline, #aaa)' }}>
          {partsInfo.length > 0
            ? `${partsInfo.length} components tracked · hover to highlight · click to isolate`
            : 'Locating assembly nodes…'}
        </div>
      </div>
    </div>
  );
}
