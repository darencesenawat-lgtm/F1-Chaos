/* ===========================
   F1 ZX — Hybrid Loader v2025
   Replaces old loadCCSF(). One file to rule them all.
   =========================== */

// ---------- utils ----------
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed ${r.status} ${url}`);
  return r.json();
}
function uniqCheck(pairs) {
  const set = new Set();
  for (const [type, id] of pairs) {
    if (!id) continue;
    const k = `${type}:${id}`;
    if (set.has(k)) throw new Error(`Duplicate ID ${k}`);
    set.add(k);
  }
}
function validateState(state) {
  // 1) uniqueness
  uniqCheck(state.teams.map(t => ['team', t.team_id]));
  uniqCheck(state.drivers.map(d => ['driver', d.driver_id]));
  uniqCheck(state.principals.map(p => ['tp', p.tp_id]));
  uniqCheck(state.engineers.map(r => ['re', r.re_id]));
  uniqCheck(state.calendar.map(c => ['circuit', c.circuit_id]));
  uniqCheck(state.rumours.map(r => ['rumour', String(r.rumour_id)]));

  // 2) referential integrity
  const teamIdx = Object.fromEntries(state.teams.map(t => [t.team_id, 1]));
  const drvIdx  = Object.fromEntries(state.drivers.map(d => [d.driver_id, 1]));
  const reIdx   = Object.fromEntries(state.engineers.map(r => [r.re_id, 1]));
  const tpIdx   = Object.fromEntries(state.principals.map(p => [p.tp_id, 1]));

  state.drivers.forEach(d => { if (!teamIdx[d.team]) throw new Error(`Driver ${d.driver_id} has unknown team ${d.team}`); });
  state.teams.forEach(t => {
    (t.drivers || []).forEach(did => { if (!drvIdx[did]) throw new Error(`Team ${t.team_id} missing driver ${did}`); });
    (t.race_engineers || []).filter(Boolean).forEach(rid => { if (!reIdx[rid]) throw new Error(`Team ${t.team_id} missing engineer ${rid}`); });
    if (!tpIdx[t.team_principal]) throw new Error(`Team ${t.team_id} missing principal ${t.team_principal}`);
  });
  state.engineers.forEach(r => {
    if (!drvIdx[r.driver]) throw new Error(`Engineer ${r.re_id} has unknown driver ${r.driver}`);
    if (!teamIdx[r.team]) throw new Error(`Engineer ${r.re_id} has unknown team ${r.team}`);
  });

  return state;
}

// ---------- module <-> state ----------
function modulesToState(modules) {
  const state = {
    meta: modules.metadata,
    regulations: modules.regulations,
    sponsors: modules.sponsors,
    teams: modules.teams,
    drivers: modules.drivers,
    principals: modules.principals,
    engineers: modules.engineers,
    calendar: modules.calendar,
    development: modules.development,
    rumours: modules.rumours,
    stats: modules.stats
  };
  validateState(state);
  const manifest = { version: '2025.0.1', season: state.meta.season, timeline: state.meta.timeline };
  return { manifest, state };
}
function stateToBundle(state, manifest = { version: '2025.0.1', season: state.meta.season, timeline: state.meta.timeline }) {
  return {
    _type: 'ccsf_bundle_v1',
    manifest,
    modules: {
      metadata: state.meta,
      regulations: state.regulations,
      sponsors: state.sponsors,
      teams: state.teams,
      drivers: state.drivers,
      principals: state.principals,
      engineers: state.engineers,
      calendar: state.calendar,
      development: state.development,
      rumours: state.rumours,
      stats: state.stats
    }
  };
}
function bundleToState(bundle) {
  return modulesToState(bundle.modules);
}

// ---------- public API ----------
/**
 * Load game data. Prefers single-file bundle; falls back to modular /seed/.
 * @param {{bundleUrl?: string|File, modularBase?: string}} opt
 */
export async function loadGame(opt = {}) {
  const { bundleUrl, modularBase = '/seed/' } = opt;

  // 1) Try player bundle via URL
  if (typeof bundleUrl === 'string') {
    try {
      const bundle = await getJSON(bundleUrl);
      if (bundle?._type === 'ccsf_bundle_v1' && bundle.modules) {
        return bundleToState(bundle); // ✅ single-file loaded
      }
      throw new Error('Invalid bundle structure');
    } catch (e) {
      console.warn('Bundle URL load failed, falling back to modular:', e);
    }
  }

  // 1b) Try player bundle via File (drag & drop)
  if (bundleUrl instanceof File) {
    const text = await bundleUrl.text();
    const obj = JSON.parse(text);
    if (obj?._type === 'ccsf_bundle_v1' && obj.modules) return bundleToState(obj);
    throw new Error('Not a valid CCSF bundle');
  }

  // 2) Modular fallback
  const base = modularBase.endsWith('/') ? modularBase : modularBase + '/';
  const manifest = await getJSON(base + 'manifest.json');

  const modules = {};
  for (const file of manifest.files) {
    modules[file.replace('.json','')] = await getJSON(base + file);
  }

  const { state } = modulesToState(modules);
  return { manifest, state };
}

/** Export current state as one player-friendly .ccsf.json file */
export function exportBundle(state) {
  const bundle = stateToBundle(validateState(state));
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ccsf_${state.meta.season}_${state.meta.timeline}.ccsf.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Minimal JSON patch applier */
export function applyPatch(target, ops) {
  for (const step of ops) {
    const parts = step.path.split('/').slice(1);
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    const key = parts[parts.length - 1];
    if (step.op === 'set') cur[key] = step.value;
    if (step.op === 'add') {
      if (Array.isArray(cur[key])) cur[key].push(step.value);
      else cur[key] = step.value;
    }
  }
  return target;
}

/** Optional: first-run initialization for brand new players */
export function firstRunInit(state) {
  // player profile scaffolding
  state.meta.player = { id: 'player_1', name: 'Rookie', difficulty: 'normal', assists: ['pitlimiter','autoERS'] };
  state.meta.selected_team = null; // force team-select UI

  // a little paddock flavor
  state.stats.boardroom_drama.push({
    ts: Date.now(),
    type: 'mail',
    title: 'Welcome to the Paddock',
    body: 'Tip: rumours are like tyres — manage the heat.'
  });

  // gentle randomization: nudge a few pending rumours
  const rng = mulberry32(20250301);
  state.rumours.forEach(r => {
    if (r.status === 'pending' && rng() > 0.86) r.status = 'gaining_traction';
  });
}

// tiny deterministic RNG
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296}}

// ---------- boot helper (optional) ----------
/**
 * Boot the game: try player save, else build from modular seed, init, and auto-save.
 */
export async function bootGame({ defaultBundle = '/saves/slot1.ccsf.json', modularBase = '/seed/' } = {}) {
  try {
    // try existing player save
    const game = await loadGame({ bundleUrl: defaultBundle, modularBase });
    return game;
  } catch {
    // first-time: build from seed, init, autosave
    const game = await loadGame({ modularBase });
    firstRunInit(game.state);
    exportBundle(game.state);
    return game;
  }
}
