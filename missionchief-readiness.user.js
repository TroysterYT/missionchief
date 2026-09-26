// ==UserScript==
// @name         MissionChief Readiness Report
// @namespace    https://github.com/TroysterYT/missionchief
// @version      0.4.0
// @description  Compares your buildings, extensions, staff training and vehicles with the missions the game can give you, and shows where you're short. Open it from the Tampermonkey menu.
// @author       TroysterYT
// @match        https://www.missionchief.com/*
// @match        https://missionchief.com/*
// @match        https://police.missionchief.com/*
// @match        https://www.missionchief.co.uk/*
// @match        https://police.missionchief.co.uk/*
// @match        https://www.missionchief-australia.com/*
// @match        https://police.missionchief-australia.com/*
// @match        https://www.leitstellenspiel.de/*
// @match        https://polizei.leitstellenspiel.de/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/TroysterYT/missionchief/main/missionchief-readiness.user.js
// @downloadURL  https://raw.githubusercontent.com/TroysterYT/missionchief/main/missionchief-readiness.user.js
// ==/UserScript==

(function () {
  'use strict';

  // BEGIN GENERATED SUBSTITUTIONS: node scripts/build-substitutions.js <lssm-v.4 checkout> --write
  // Derived from LSS-Manager 4.7.12+20260923.1524 (https://github.com/LSS-Manager/lssm-v.4), CC BY-NC-SA 4.0.
  const SUBSTITUTIONS = {"en_GB":{"req":{"firetrucks":[0,1,16,17,26,37,38,47],"platform_trucks":[2,17],"battalion_chief_vehicles":[3,15,44,77],"heavy_rescue_vehicles":[4,16,38,43],"mobile_air_vehicles":[14,39,46,49],"water_tankers":[6,26,36,41,50],"mobile_command_vehicles":[15,31,44,77],"hazmat_vehicles":[7,32,39,48,49],"ambulances":[5],"police_cars":[8,12,13,19,24,25,51,52,56,82,116],"helicopter":[9],"rth":[9],"police_helicopters":[11],"swat_suv":[13,25,52,56,82],"k9":[12,53],"kdow_orgl":[20,31,34],"traffic_car":[24,25],"atv_carrier":[30],"hazard_response_primary":[27],"hazard_response_secondary":[28],"emergency_welfare":[29,39,45,49,115],"ems_mobile_command":[34],"foam":[35,36,37,38,42,75],"mass_casualty_equipment":[33],"police_horse":[55],"water_rescue":[66,73,93],"height_rescue_units":[59],"flood_equipment":[61],"coastal_rescue":[57,58,59],"coastal_command":[60],"coastal_boat":[67,74],"large_coastal_boat":[68,69],"coastal_guard_boat":[69],"coastal_helicopter":[64,65],"mud_rescue":[62],"coastal_support":[63],"coastal_jetski":[70],"coastal_mud_rescue":[58],"coastal_boat_hover":[71],"arff":[75],"riv":[76],"rettungstreppe":[2,17,78],"elw_airport":[77],"airport_equipment":[79,80],"airport_command":[80],"search_and_rescue":[86,87,92],"search_and_rescue_command":[85],"midwife":[95],"rescue_dogs":[101,102],"two_way":[107],"railway_police":[108],"bomb_disposal_command":[109],"bomb_disposal_crew":[110],"bomb_disposal_equipment":[111],"bomb_disposal_heavy_equipment":[112],"bomb_disposal_diver_crew":[113],"bomb_disposal_diver_equipment":[114],"oneof_fire_engine_or_airport_fire_engine":[0,1,16,17,26,37,38,47,76],"oneof_fire_engine_or_airport_fire_engine_large":[0,1,16,17,26,37,38,47,75],"oneof_fire_engine_or_airport_fire_engine_or_engine_large":[0,1,16,17,26,37,38,47,75,76],"oneof_airport_fire_engine_or_engine_large":[75,76],"oneof_fire_engine_or_rescue":[0,1,4,16,17,26,37,38,43,47],"oneof_fire_engine_or_rescue_or_ladder":[0,1,2,4,16,17,26,37,38,43,47],"oneof_fire_ladder_or_rescue_stairs":[2,17,78],"oneof_fire_command_or_airport_fire_command":[3,15,44,77],"oneof_fire_command_advanced_or_airport_fire_command":[15,31,44,77],"oneof_coastal_guard_boat_or_boat_large":[68,69],"oneof_police_patrol_or_swat":[8,12,13,19,24,25,51,52,56,82,116],"oneof_police_drone_or_helicopter":[11,89,90,91],"oneof_mountain_atv_or_search_and_rescue_atv":[66,73,93,99],"oneof_paramedic_or_paramedic_advanced":[94,96]},"alt":{"allow_rw_instead_of_lf":{"firetrucks":[0,1,4,16,17,26,37,38,43,47]},"allow_arff_instead_of_lf":{"firetrucks":[75,76]}}}};
  // END GENERATED SUBSTITUTIONS

  /* ------------------------------------------------------------------ *
   * Core: pure analysis (no DOM). Unit tested.                          *
   * ------------------------------------------------------------------ */
  const CORE = (() => {
    const toNum = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

    /** Keep only positive numeric entries. */
    function numMap(o) {
      const out = {};
      for (const [k, v] of Object.entries(o || {})) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) out[k] = n;
      }
      return out;
    }

    /** einsaetze.json may be an array or an object keyed by id. */
    function normalizeMissions(json) {
      const entries = Array.isArray(json) ? json.map((m, i) => [String(m && m.id !== undefined ? m.id : i), m])
        : Object.entries(json || {});
      const out = [];
      for (const [key, m] of entries) {
        if (!m || typeof m !== 'object') continue;
        const add = m.additional || {};
        const pre = m.prerequisites || {};
        let specs = add.patient_specializations ?? add.patient_specialization ?? [];
        if (typeof specs === 'string') specs = specs.split(',');
        const id = String(m.id !== undefined ? m.id : key);
        const prereq = numMap(pre);
        delete prereq.main_building;
        out.push({
          id,
          name: String(m.name || m.caption || `Mission ${id}`),
          prereq,
          mainBuilding: toNum(pre.main_building),
          req: numMap(m.requirements),
          edu: numMap(add.personnel_educations || add.personnelEducations),
          specs: (Array.isArray(specs) ? specs : []).map((s) => String(s).trim()).filter(Boolean),
          credits: toNum(m.average_credits) || 0,
          overlay: id.includes('/'),
          allow: Object.keys(add).filter((k) => k.startsWith('allow_') && add[k]),
        });
      }
      return out;
    }

    const STOP = new Set(['vehicle', 'vehicles', 'car', 'cars', 'unit', 'units', 'the', 'of', 'and', 'type', 'personnel', 'station', 'stations']);
    function tokens(s) {
      return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
        .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t))
        .filter((t) => t.length > 1 && !STOP.has(t));
    }

    // Phrases that identify what a requirement key means, for US and UK wording. Excludes stop false matches.
    const SYN = {
      // Dual-role vehicles count for several requirements: UK CARP (Combined Aerial Rescue Pump) is a pump and an
      // aerial; US Quint is an engine and a platform truck; US Rescue Engine is an engine and a heavy rescue.
      firetrucks: { any: ['fire engine', 'engine', 'water ladder', 'pump', 'water tender', 'type 1', 'type 2', 'carp', 'quint'], not: /air|arff|airport|boat|officer|chief|foam|tanker|carrier/ },
      platform_trucks: { any: ['aerial', 'ladder', 'platform', 'turntable', 'tower', 'carp', 'quint'], not: /water ladder/ },
      battalion_chief_vehicles: { any: ['battalion chief', 'fire officer', 'officer', 'chief'], not: /ems|police/ },
      heavy_rescue_vehicles: { any: ['heavy rescue', 'rescue support', 'rescue tender', 'rescue unit', 'rescue engine'] },
      hazmat_vehicles: { any: ['hazmat', 'hazardous', 'haz mat', 'detection', 'dim'] },
      mobile_command_vehicles: { any: ['mobile command', 'command support', 'incident command', 'command unit', 'control unit'] },
      water_tankers: { any: ['tanker', 'water carrier', 'bulk water'] },
      ambulances: { any: ['ambulance'], not: /air|helicopter|hems|hart|officer|bus/ },
      police_cars: { any: ['patrol', 'police car', 'incident response', 'response car', 'area car'], not: /helicopter|dog|armed|boat|swat/ },
      arff: { any: ['arff', 'airport', 'crash tender'] },
      swat: { any: ['swat', 'armed response', 'arv', 'tactical'] },
      police_helicopters: { any: ['police helicopter', 'npas'] },
      helicopter: { any: ['air ambulance', 'helicopter'] },
      k9: { any: ['k9', 'dog'] },
      dog_cars: { any: ['dog'] },
      boats: { any: ['boat', 'water rescue', 'lifeboat'] },
      hart: { any: ['hart'] },
      ems_chiefs: { any: ['ems chief', 'ems supervisor', 'operations manager', 'ambulance officer'] },
      fly_cars: { any: ['rapid response', 'rrv', 'fly car'] },
    };

    /** Guess which candidates [{id, caption}] satisfy a requirement key. Returns candidate ids. */
    function autoMap(key, candidates) {
      const syn = SYN[key] || SYN[`${key}s`] || null;
      const kt = tokens(key.replace(/_/g, ' '));
      const scored = candidates.map((c) => {
        const cap = String(c.caption || '').toLowerCase();
        if (syn && syn.not && syn.not.test(cap)) return { id: c.id, score: 0 };
        let score = 0;
        if (syn && syn.any.some((p) => cap.includes(p))) score += 3;
        const ct = tokens(cap);
        if (kt.length) score += (2 * kt.filter((t) => ct.includes(t)).length) / kt.length;
        return { id: c.id, score };
      });
      const best = Math.max(0, ...scored.map((s) => s.score));
      if (best < 1) return [];
      return scored.filter((s) => s.score >= 3 || s.score >= best - 1e-9).map((s) => s.id);
    }

    /** Do any of the hospital extension captions cover this patient specialization? */
    function specCovered(spec, captions) {
      const st = tokens(spec);
      if (!st.length) return true;
      return captions.some((c) => {
        const ct = tokens(c);
        return st.filter((t) => ct.includes(t)).length / st.length >= 0.5;
      });
    }

    const sumOf = (ids, counts) => ids.reduce((s, id) => s + (counts[String(id)] || 0), 0);

    /**
     * How many requirement slots can be filled when each vehicle fills at most one slot (a vehicle that counts for
     * several requirements, like a CARP, still only goes once). reqs: [{need, ids}], counts: {typeId: n}.
     * Max-flow over source → vehicle type → requirement → sink.
     */
    function maxAssign(reqs, counts) {
      const types = [...new Set(reqs.flatMap((r) => r.ids.map(String)))].filter((id) => counts[id] > 0);
      const n = types.length + reqs.length + 2;
      const src = 0;
      const sink = n - 1;
      const cap = Array.from({ length: n }, () => new Array(n).fill(0));
      types.forEach((id, i) => { cap[src][1 + i] = counts[id]; });
      reqs.forEach((r, j) => {
        const rj = 1 + types.length + j;
        cap[rj][sink] = r.need;
        for (const id of r.ids.map(String)) {
          const i = types.indexOf(id);
          if (i >= 0) cap[1 + i][rj] = Infinity;
        }
      });
      let total = 0;
      for (;;) {
        const prev = new Array(n).fill(-1);
        prev[src] = src;
        const queue = [src];
        while (queue.length && prev[sink] < 0) {
          const u = queue.shift();
          for (let v = 0; v < n; v++) if (prev[v] < 0 && cap[u][v] > 0) { prev[v] = u; queue.push(v); }
        }
        if (prev[sink] < 0) return total;
        let f = Infinity;
        for (let v = sink; v !== src; v = prev[v]) f = Math.min(f, cap[prev[v]][v]);
        for (let v = sink; v !== src; v = prev[v]) { cap[prev[v]][v] -= f; cap[v][prev[v]] += f; }
        total += f;
      }
    }

    /**
     * input: {
     *   missions: normalized missions,
     *   buildingCounts: {typeId: n}, vehicleCounts: {typeId: n}, trainingCounts: {name: n} | null,
     *   hospitalExtensions: [caption],
     *   maps: {prereq: {key: [typeId]}, req: {key: [typeId]}, edu: {key: [name]}, alt?: {allowFlag: {key: [typeId]}}}
     *   skip: {buildingTypes: [typeId], specs: bool}  (optional: leave these out, e.g. hospitals)
     * }
     */
    function analyze(input) {
      const { missions, buildingCounts, vehicleCounts, trainingCounts, hospitalExtensions, maps } = input;
      const skipTypes = new Set(((input.skip && input.skip.buildingTypes) || []).map(String));
      const skipSpecs = !!(input.skip && input.skip.specs);
      const unknown = { prereq: new Set(), req: new Set(), edu: new Set() };
      const rows = missions.map((m) => {
        const missing = [];
        for (const [k, need] of Object.entries(m.prereq)) {
          const mapped = maps.prereq[k];
          if (!mapped || !mapped.length) {
            unknown.prereq.add(k);
            continue;
          }
          const ids = mapped.filter((id) => !skipTypes.has(String(id)));
          if (!ids.length) continue; // only left-out building types satisfy this: ignore it
          const have = sumOf(ids, buildingCounts);
          if (have < need) missing.push({ key: k, need, have });
        }
        if (m.mainBuilding !== null && m.mainBuilding !== undefined && !skipTypes.has(String(m.mainBuilding))
          && !(buildingCounts[String(m.mainBuilding)] > 0)) {
          missing.push({ key: `main_building:${m.mainBuilding}`, need: 1, have: 0 });
        }
        const short = [];
        const vehReqs = [];
        for (const [k, need] of Object.entries(m.req)) {
          let ids = maps.req[k];
          // Some missions also accept other vehicles for a requirement (e.g. rescue vehicles instead of pumps).
          const extra = (m.allow || []).flatMap((f) => (maps.alt && maps.alt[f] && maps.alt[f][k]) || []);
          if (ids && ids.length && extra.length) ids = [...new Set([...ids.map(String), ...extra.map(String)])];
          if (!ids || !ids.length) {
            unknown.req.add(k);
            continue;
          }
          const have = sumOf(ids, vehicleCounts);
          if (have < need) short.push({ kind: 'vehicle', key: k, need, have });
          vehReqs.push({ key: k, need, ids });
        }
        // Each requirement may be fine alone while shared vehicles can't cover them all at once.
        if (!short.length && vehReqs.length > 1) {
          const overlapping = vehReqs.filter((a) => vehReqs.some((b) => b !== a && a.ids.some((id) => b.ids.map(String).includes(String(id)))));
          if (overlapping.length > 1) {
            const need = overlapping.reduce((t, r) => t + r.need, 0);
            const have = maxAssign(overlapping, vehicleCounts);
            if (have < need) short.push({ kind: 'vehicle', key: overlapping.map((r) => r.key).sort().join('+'), need, have, combined: true });
          }
        }
        for (const [k, need] of Object.entries(m.edu)) {
          const names = maps.edu[k];
          if (!trainingCounts || !names || !names.length) {
            unknown.edu.add(k);
            continue;
          }
          const have = sumOf(names, trainingCounts);
          if (have < need) short.push({ kind: 'training', key: k, need, have });
        }
        for (const sp of skipSpecs ? [] : m.specs) {
          if (!specCovered(sp, hospitalExtensions)) short.push({ kind: 'specialization', key: sp, need: 1, have: 0 });
        }
        return { m, missing, unlocked: !missing.length, short };
      });

      // Gaps on missions you can already get.
      const gapMap = new Map();
      for (const r of rows) {
        if (!r.unlocked) continue;
        for (const s of r.short) {
          const id = `${s.kind}:${s.key}`;
          const g = gapMap.get(id) || { kind: s.kind, key: s.key, have: s.have, maxNeed: 0, missions: [], credits: 0 };
          g.maxNeed = Math.max(g.maxNeed, s.need);
          g.missions.push(r.m.name);
          g.credits += r.m.credits;
          gapMap.set(id, g);
        }
      }
      const gaps = [...gapMap.values()].sort((a, b) => b.missions.length - a.missions.length || b.credits - a.credits);

      // What to build next: missions blocked by exactly one prerequisite.
      const unlockMap = new Map();
      for (const r of rows) {
        if (r.missing.length !== 1) continue;
        const x = r.missing[0];
        const u = unlockMap.get(x.key) || { key: x.key, have: x.have, byExtra: new Map(), names: [] };
        const extra = x.need - x.have;
        u.byExtra.set(extra, (u.byExtra.get(extra) || 0) + 1);
        u.names.push(r.m.name);
        unlockMap.set(x.key, u);
      }
      const unlocks = [...unlockMap.values()].map((u) => {
        let cum = 0;
        const steps = [...u.byExtra.entries()].sort((a, b) => a[0] - b[0]).map(([extra, n]) => {
          cum += n;
          return { extra, unlocks: cum };
        });
        return { key: u.key, have: u.have, steps, total: cum, names: u.names };
      }).sort((a, b) => a.steps[0].extra - b.steps[0].extra || b.total - a.total);

      const unlocked = rows.filter((r) => r.unlocked);
      return {
        rows,
        total: rows.length,
        unlocked: unlocked.length,
        covered: unlocked.filter((r) => !r.short.length).length,
        gaps,
        unlocks,
        unknown: { prereq: [...unknown.prereq], req: [...unknown.req], edu: [...unknown.edu] },
      };
    }

    function distKm(lat1, lng1, lat2, lng2) {
      const toRad = Math.PI / 180;
      const dLat = (lat2 - lat1) * toRad;
      const dLng = (lng2 - lng1) * toRad;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
      return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    /**
     * For each station, how many vehicles of the given types are within radiusKm (its own included).
     * stations: [{id, name, lat, lng, vehicles: {typeId: n}}]. Returns stations below `need`, fewest first.
     */
    function localShortfall(stations, typeIds, need, radiusKm) {
      const ids = typeIds.map(String);
      const counts = stations.map((s) => ids.reduce((n, id) => n + (s.vehicles[id] || 0), 0));
      const out = [];
      stations.forEach((s, i) => {
        let n = 0;
        stations.forEach((o, j) => {
          if (counts[j] && distKm(s.lat, s.lng, o.lat, o.lng) <= radiusKm) n += counts[j];
        });
        if (n < need) out.push({ ...s, have: n });
      });
      return out.sort((a, b) => a.have - b.have);
    }

    return { normalizeMissions, tokens, autoMap, specCovered, analyze, localShortfall, distKm, maxAssign, SUBSTITUTIONS };
  })();

  if (typeof module === 'object' && module.exports) {
    module.exports = CORE;
    return;
  }

  /* ------------------------------------------------------------------ *
   * Browser part                                                        *
   * ------------------------------------------------------------------ */
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (window.top !== window.self) return;
  if (location.pathname !== '/') return;

  const HOST = location.hostname.replace(/^www\./, '');
  const LOCALES = {
    'missionchief.com': 'en_US', 'police.missionchief.com': 'en_US', 'missionchief.co.uk': 'en_GB', 'police.missionchief.co.uk': 'en_GB',
    'missionchief-australia.com': 'en_AU', 'police.missionchief-australia.com': 'en_AU', 'leitstellenspiel.de': 'de_DE', 'polizei.leitstellenspiel.de': 'de_DE',
  };
  // The map filter script stores type names and staff scans under this prefix; reuse them when present.
  const MCMF = `mcmf:${HOST}:`;
  const MCR = `mcr:${HOST}:`;
  const lsGet = (k, d) => {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  };
  const lsSet = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      console.warn('[MCR] could not save', k, e);
    }
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function getJSON(url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k in el && typeof el[k] !== 'function') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  function download(name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------------- data ---------------- */

  const state = {
    loading: false, error: '', buildings: [], vehicles: [], missions: [], meta: { b: {}, v: {} },
    staff: lsGet(`${MCMF}staff`, {}), report: null, radiusKm: lsGet(`${MCR}radius`, 20), noHospitals: lsGet(`${MCR}noHospitals`, false),
    overrides: lsGet(`${MCR}maps`, { prereq: {}, req: {}, edu: {} }),
    scan: { running: false, abort: false, done: 0, total: 0 },
  };

  async function loadVehicles() {
    try {
      const out = [];
      let url = '/api/v2/vehicles';
      for (let guard = 0; url && guard < 500; guard++) {
        const j = await getJSON(url);
        if (!j || !Array.isArray(j.result)) throw new Error('unexpected v2 format');
        out.push(...j.result);
        url = (j.paging && j.paging.next_page) || null;
      }
      return out;
    } catch (e) {
      const j = await getJSON('/api/vehicles');
      return Array.isArray(j) ? j : j.result || [];
    }
  }

  function captionsFrom(obj) {
    const out = {};
    const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj || {});
    for (const [k, v] of entries) if (v && (v.caption || v.name)) out[String(k)] = String(v.caption || v.name);
    return out;
  }

  async function loadMeta() {
    const cached = lsGet(`${MCMF}meta`, null);
    if (cached && Date.now() - cached.ts < 24 * 3600e3 && Object.keys(cached.v || {}).length) return cached;
    const locale = LOCALES[HOST] || 'en_US';
    try {
      const [b, v] = await Promise.all([
        fetch(`https://api.lss-manager.de/${locale}/buildings`).then((r) => r.json()),
        fetch(`https://api.lss-manager.de/${locale}/vehicles`).then((r) => r.json()),
      ]);
      const meta = { ts: Date.now(), b: captionsFrom(b), v: captionsFrom(v) };
      lsSet(`${MCMF}meta`, meta);
      return meta;
    } catch (e) {
      console.warn('[MCR] type names unavailable', e);
      return cached || { b: {}, v: {} };
    }
  }

  async function loadAll() {
    state.loading = true;
    state.error = '';
    render();
    try {
      const [b, v, m, meta] = await Promise.all([getJSON('/api/buildings'), loadVehicles(), getJSON('/einsaetze.json'), loadMeta()]);
      state.buildings = Array.isArray(b) ? b : b.result || [];
      state.vehicles = v;
      state.missions = CORE.normalizeMissions(m);
      state.meta = meta;
      if (!state.missions.length) throw new Error('The game’s mission list (/einsaetze.json) came back empty.');
      buildReport();
    } catch (e) {
      console.error('[MCR]', e);
      state.error = e.message;
    }
    state.loading = false;
    render();
  }

  const typeName = (id) => state.meta.b[String(id)] || `Building type ${id}`;
  const isHospitalType = (id) => /hospital|krankenhaus/i.test(typeName(id));
  const vehName = (id) => state.meta.v[String(id)] || `Vehicle type ${id}`;

  /**
   * Everything a requirement can be matched to: {id, caption, owned}. Vehicle captions also include any custom type
   * names you gave your vehicles (e.g. "CARP"), so the automatic matching can use them.
   */
  function candidates() {
    const veh = new Map(Object.keys(state.meta.v).map((id) => [id, { owned: 0, names: new Set() }]));
    for (const v of state.vehicles) {
      const id = String(v.vehicle_type);
      if (!veh.has(id)) veh.set(id, { owned: 0, names: new Set() });
      const e = veh.get(id);
      e.owned++;
      if (v.vehicle_type_caption && v.vehicle_type_caption !== vehName(id)) e.names.add(String(v.vehicle_type_caption));
    }
    const bld = new Map(Object.keys(state.meta.b).map((id) => [id, 0]));
    for (const b of state.buildings) bld.set(String(b.building_type), (bld.get(String(b.building_type)) || 0) + 1);
    const trainings = new Map();
    for (const s of Object.values(state.staff)) for (const [t, n] of Object.entries(s.trainings || {})) trainings.set(t, (trainings.get(t) || 0) + n);
    return {
      veh: [...veh.entries()].map(([id, e]) => ({ id, caption: [vehName(id), ...e.names].join(' / '), owned: e.owned })),
      bld: [...bld.entries()].map(([id, n]) => ({ id, caption: typeName(id), owned: n })),
      edu: [...trainings.entries()].map(([t, n]) => ({ id: t, caption: t, owned: n })),
    };
  }

  /** Mapping per key: your saved choice, else the automatic guess. */
  function mappings() {
    const c = candidates();
    const keys = { prereq: new Set(), req: new Set(), edu: new Set() };
    for (const m of state.missions) {
      Object.keys(m.prereq).forEach((k) => keys.prereq.add(k));
      Object.keys(m.req).forEach((k) => keys.req.add(k));
      Object.keys(m.edu).forEach((k) => keys.edu.add(k));
    }
    const known = (SUBSTITUTIONS[LOCALES[HOST]] || {});
    const pick = (kind, key, cands) => {
      const o = state.overrides[kind] && state.overrides[kind][key];
      if (o) return { ids: o, auto: false, source: 'yours' };
      if (kind === 'req' && known.req && known.req[key]) return { ids: known.req[key].map(String), auto: true, source: 'lssm' };
      return { ids: CORE.autoMap(key, cands), auto: true, source: 'guess' };
    };
    const out = { prereq: {}, req: {}, edu: {}, auto: { prereq: {}, req: {}, edu: {} }, source: { prereq: {}, req: {}, edu: {} }, alt: known.alt || {}, cands: c };
    for (const k of keys.prereq) {
      const p = pick('prereq', k, c.bld);
      out.prereq[k] = p.ids;
      out.auto.prereq[k] = p.auto;
      out.source.prereq[k] = p.source;
    }
    for (const k of keys.req) {
      const p = pick('req', k, c.veh);
      out.req[k] = p.ids;
      out.auto.req[k] = p.auto;
      out.source.req[k] = p.source;
    }
    for (const k of keys.edu) {
      const p = pick('edu', k, c.edu);
      out.edu[k] = p.ids;
      out.auto.edu[k] = p.auto;
      out.source.edu[k] = p.source;
    }
    return out;
  }

  function buildReport() {
    const buildingCounts = {};
    for (const b of state.buildings) buildingCounts[String(b.building_type)] = (buildingCounts[String(b.building_type)] || 0) + 1;
    const vehicleCounts = {};
    for (const v of state.vehicles) vehicleCounts[String(v.vehicle_type)] = (vehicleCounts[String(v.vehicle_type)] || 0) + 1;
    const scanned = state.buildings.filter((b) => state.staff[b.id]);
    let trainingCounts = null;
    if (scanned.length) {
      trainingCounts = {};
      for (const b of scanned) for (const [t, n] of Object.entries(state.staff[b.id].trainings || {})) trainingCounts[t] = (trainingCounts[t] || 0) + n;
    }
    const hospitalExtensions = [];
    for (const b of state.buildings) {
      if (!/hospital|krankenhaus/i.test(typeName(b.building_type))) continue;
      for (const e of b.extensions || []) if (e.available && e.enabled !== false) hospitalExtensions.push(String(e.caption));
    }
    const maps = mappings();
    const hospitalTypes = state.noHospitals ? maps.cands.bld.map((c) => c.id).filter(isHospitalType) : [];
    const res = CORE.analyze({
      missions: state.missions, buildingCounts, vehicleCounts, trainingCounts, hospitalExtensions, maps: { ...maps, alt: maps.alt },
      skip: { buildingTypes: hospitalTypes, specs: state.noHospitals },
    });
    const listed = state.noHospitals ? state.buildings.filter((b) => !isHospitalType(b.building_type)) : state.buildings;

    // Where on the map each vehicle gap bites.
    const vehByBuilding = new Map();
    for (const v of state.vehicles) {
      const m = vehByBuilding.get(v.building_id) || {};
      m[String(v.vehicle_type)] = (m[String(v.vehicle_type)] || 0) + 1;
      vehByBuilding.set(v.building_id, m);
    }
    const stations = state.buildings.filter((b) => vehByBuilding.has(b.id)).map((b) => ({
      id: b.id, name: b.caption, lat: Number(b.latitude), lng: Number(b.longitude), vehicles: vehByBuilding.get(b.id),
    }));
    const maxNeed = {};
    for (const r of res.rows) if (r.unlocked) for (const [k, n] of Object.entries(r.m.req)) maxNeed[k] = Math.max(maxNeed[k] || 0, n);
    const local = Object.entries(maxNeed)
      .filter(([k]) => maps.req[k] && maps.req[k].length)
      .map(([k, need]) => {
        const weak = CORE.localShortfall(stations, maps.req[k], need, Number(state.radiusKm) || 20);
        return { key: k, need, weak, share: stations.length ? weak.length / stations.length : 0 };
      })
      .filter((x) => x.weak.length)
      .sort((a, b) => b.share - a.share);

    const out6 = state.vehicles.filter((v) => Number(v.fms_real) === 6);
    const understaffed = listed.filter((b) => Number(b.personal_count_goal) > Number(b.personal_count));
    const typesWithVehicles = new Set(state.buildings.filter((b) => vehByBuilding.has(b.id)).map((b) => b.building_type));
    const empty = listed.filter((b) => typesWithVehicles.has(b.building_type) && !vehByBuilding.has(b.id));

    state.report = {
      ...res, maps, local, stationsCount: stations.length, out6, understaffed, empty,
      scanned: scanned.length, staffed: state.buildings.filter((b) => Number(b.personal_count) > 0).length,
      counts: { buildings: state.buildings.length, vehicles: state.vehicles.length },
      at: new Date(),
    };
  }

  /* ---------------- staff scan (same cache as the map filter script) ---------------- */

  function parsePersonnel(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('#personal_table') || doc.querySelector('table');
    const trainings = {};
    let total = 0;
    if (!table) return { total, trainings };
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim().toLowerCase());
    let col = heads.findIndex((t) => /train|educat|school|ausbild|qualif|opleid/.test(t));
    if (col < 0) col = 1;
    for (const tr of table.querySelectorAll('tbody tr')) {
      const tds = tr.querySelectorAll('td');
      if (!tds.length) continue;
      total++;
      const txt = (tds[col] ? tds[col].textContent : '').trim();
      for (const t of txt.split(',').map((s) => s.trim()).filter(Boolean)) trainings[t] = (trainings[t] || 0) + 1;
    }
    return { total, trainings };
  }

  async function scanStaff() {
    const sc = state.scan;
    if (sc.running) return;
    const todo = state.buildings.filter((b) => Number(b.personal_count) > 0
      && !(state.staff[b.id] && Date.now() - state.staff[b.id].ts < 24 * 3600e3));
    Object.assign(sc, { running: true, abort: false, done: 0, total: todo.length });
    render();
    for (const b of todo) {
      if (sc.abort) break;
      try {
        const r = await fetch(`/buildings/${b.id}/personals`, { credentials: 'include' });
        if (r.ok) state.staff[b.id] = { ts: Date.now(), ...parsePersonnel(await r.text()) };
      } catch (e) { /* skip this building */ }
      sc.done++;
      if (sc.done % 10 === 0) lsSet(`${MCMF}staff`, state.staff);
      const el = document.getElementById('mcr-scan');
      if (el) el.textContent = `Scanning staff… ${sc.done} / ${sc.total}`;
      await sleep(350);
    }
    sc.running = false;
    lsSet(`${MCMF}staff`, state.staff);
    buildReport();
    render();
  }

  /* ---------------- UI ---------------- */

  const CSS = `
  #mcr{--bg:#fff;--fg:#1f2430;--muted:#6b7280;--line:#e2e5eb;--soft:#f5f6f8;--accent:#2563eb;--bad:#b91c1c;--warn:#b45309;--ok:#15803d;
    position:fixed;inset:0;z-index:100000;background:rgba(15,18,24,.55);display:flex;align-items:flex-start;justify-content:center;overflow:auto;
    font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  #mcr.dark{--bg:#1e2228;--fg:#e6e8ec;--muted:#9aa3b2;--line:#353b45;--soft:#262b32;--accent:#60a5fa;--bad:#fca5a5;--warn:#fcd34d;--ok:#86efac}
  #mcr *{box-sizing:border-box}
  #mcr .box{background:var(--bg);color:var(--fg);width:min(1100px,100%);margin:24px 16px;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
  #mcr .top{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);border-radius:12px 12px 0 0;z-index:1}
  #mcr h2{margin:0;font-size:18px;flex:1;color:var(--fg)}
  #mcr h3{margin:22px 0 8px;font-size:15px;color:var(--fg)}
  #mcr .body{padding:6px 18px 20px}
  #mcr .muted{color:var(--muted);font-size:13px}
  #mcr .bad{color:var(--bad)} #mcr .warn{color:var(--warn)} #mcr .ok{color:var(--ok)}
  #mcr .btn{background:var(--soft);color:var(--fg);border:1px solid var(--line);border-radius:7px;padding:5px 11px;cursor:pointer;font:inherit;font-size:13px}
  #mcr .btn:hover{border-color:var(--accent)} #mcr .btn:disabled{opacity:.5;cursor:default}
  #mcr .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  #mcr .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}
  #mcr .tile{background:var(--soft);border-radius:10px;padding:10px 12px}
  #mcr .tile b{display:block;font-size:22px}
  #mcr table{width:100%;border-collapse:collapse;font-size:13px}
  #mcr th,#mcr td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  #mcr th{color:var(--muted);font-weight:600}
  #mcr td.n{text-align:right;white-space:nowrap}
  #mcr details{border:1px solid var(--line);border-radius:8px;margin:6px 0;padding:6px 10px}
  #mcr summary{cursor:pointer;font-weight:600}
  #mcr .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;max-height:180px;overflow:auto}
  #mcr .chip{border:1px solid var(--line);background:var(--soft);color:var(--fg);border-radius:12px;padding:1px 8px;font-size:12px;cursor:pointer}
  #mcr .chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
  #mcr .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  #mcr input[type=number]{width:70px;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:3px 6px}
  `;

  let root = null;

  function isDark() {
    if (document.body.classList.contains('dark')) return true;
    const rgb = (getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g) || []).map(Number);
    return rgb.length >= 3 && rgb[3] !== 0 && 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 110;
  }

  function open() {
    if (!document.getElementById('mcr-css')) document.head.append(h('style', { id: 'mcr-css' }, CSS));
    if (!root) {
      root = h('div', { id: 'mcr', class: isDark() ? 'dark' : '', onclick: (e) => { if (e.target === root) close(); } });
      document.body.append(root);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root) close(); });
    }
    render();
    if (!state.report && !state.loading) loadAll();
  }

  function close() {
    if (root) root.remove();
    root = null;
  }

  function showOnMap(lat, lng) {
    close();
    if (W.map && W.map.setView) W.map.setView([lat, lng], 14);
  }

  const labelFor = (kind, key) => {
    if (kind === 'prereq' && key.startsWith('main_building:')) return `a ${typeName(key.split(':')[1])}`;
    const table = { vehicle: 'req', req: 'req', training: 'edu', edu: 'edu', prereq: 'prereq' }[kind];
    const ids = state.report && table ? state.report.maps[table][key] : null; // specializations have no matching table
    const names = (ids || []).map((id) => (table === 'prereq' ? typeName(id) : table === 'req' ? vehName(id) : id));
    if (kind === 'specialization') return `Hospital specialty: ${key}`;
    const pretty = key.replace(/_/g, ' ');
    return names.length ? `${pretty} (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''})` : pretty;
  };

  function render() {
    if (!root) return;
    const r = state.report;
    const box = h('div', { class: 'box' });
    box.append(h('div', { class: 'top' },
      h('h2', null, 'Readiness report'),
      r ? h('span', { class: 'muted' }, `Updated ${r.at.toLocaleTimeString()}`) : null,
      h('button', { class: 'btn', disabled: state.loading, onclick: loadAll }, state.loading ? 'Loading…' : '⟳ Refresh'),
      r ? h('button', { class: 'btn', onclick: exportReport }, 'Export') : null,
      h('button', { class: 'btn', onclick: close, title: 'Close (Esc)' }, '✕')));
    const body = h('div', { class: 'body' });
    box.append(body);
    if (state.error) body.append(h('p', { class: 'bad' }, `Couldn’t build the report: ${state.error}`));
    if (!r) {
      body.append(h('p', { class: 'muted' }, state.loading ? 'Loading your buildings, vehicles and the game’s mission list…' : ''));
      root.replaceChildren(box);
      return;
    }

    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    body.append(h('label', { class: 'row', style: 'margin-top:12px' },
      h('input', {
        type: 'checkbox', checked: state.noHospitals,
        onchange: (e) => {
          state.noHospitals = e.target.checked;
          lsSet(`${MCR}noHospitals`, state.noHospitals);
          buildReport();
          render();
        },
      }),
      'Leave out hospitals (their building requirements, specialties and housekeeping)'));
    body.append(h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('b', null, `${r.unlocked} / ${r.total}`), 'mission types unlocked'),
      h('div', { class: 'tile' }, h('b', null, `${pct(r.covered, r.unlocked)}%`), `of unlocked missions your own fleet can fully handle (${r.covered})`),
      h('div', { class: 'tile' }, h('b', null, r.counts.buildings), 'buildings'),
      h('div', { class: 'tile' }, h('b', null, r.counts.vehicles), 'vehicles'),
      h('div', { class: 'tile' }, h('b', null, `${r.scanned} / ${r.staffed}`), 'stations’ staff scanned')));

    if (r.scanned < r.staffed) {
      body.append(h('div', { class: 'row' },
        h('span', { class: 'warn' }, 'Staff training is only counted for scanned stations.'),
        state.scan.running
          ? [h('span', { id: 'mcr-scan', class: 'muted' }, `Scanning staff… ${state.scan.done} / ${state.scan.total}`),
            h('button', { class: 'btn', onclick: () => { state.scan.abort = true; } }, 'Stop')]
          : h('button', { class: 'btn', onclick: scanStaff }, `Scan staff (${r.staffed - r.scanned} stations, ~${Math.ceil(((r.staffed - r.scanned) * 0.45) / 60)} min)`)));
    }

    // Biggest gaps
    body.append(h('h3', null, 'Where you’re short'),
      h('p', { class: 'muted' }, 'Things missions you can already get need, but you don’t have enough of anywhere. Sorted by how many mission types are affected.'));
    if (!r.gaps.length) body.append(h('p', { class: 'ok' }, 'No shortfalls found for unlocked missions.'));
    else {
      body.append(h('p', { class: 'muted' },
        'Vehicles that count as more than one type (for example a CARP is both a pump and an aerial appliance) are included'
        + (SUBSTITUTIONS[LOCALES[HOST]] ? ' using LSS-Manager’s list for your game.' : ' where known.')
        + ' If a row still counts too few, press Fix and click the vehicle types that should count.'));
      body.append(h('table', null,
        h('tr', null, h('th', null, 'Need'), h('th', null, 'Kind'), h('th', { class: 'n' }, 'You have'), h('th', { class: 'n' }, 'Up to'),
          h('th', { class: 'n' }, 'Missions'), h('th', null, 'For example'), h('th', null, '')),
        r.gaps.slice(0, 40).flatMap((g) => {
          const combined = g.key.includes('+');
          const table = combined ? null : { vehicle: 'req', training: 'edu' }[g.kind];
          const counted = table ? (r.maps[table][g.key] || []).map((id) => (table === 'req' ? vehName(id) : id)) : [];
          const editRow = h('tr', { hidden: true }, h('td', { colspan: 7 }));
          const fix = table ? h('button', {
            class: 'btn',
            onclick: () => {
              if (!editRow.firstChild.firstChild) editRow.firstChild.append(chipEditor(table, g.key, () => { buildReport(); render(); }));
              editRow.hidden = !editRow.hidden;
            },
          }, 'Fix') : null;
          return [h('tr', null,
            h('td', null, g.kind === 'specialization' ? labelFor(g.kind, g.key)
              : combined ? `${g.key.split('+').map((k) => k.replace(/_/g, ' ')).join(' + ')} together` : g.key.replace(/_/g, ' '),
              combined ? h('div', { class: 'muted' }, 'Enough of each on its own, but some vehicles count for more than one of these and can only fill one slot per mission.') : null,
              counted.length ? h('div', { class: 'muted' }, `Counting: ${counted.join(', ')}`) : null),
            h('td', { class: 'muted' }, g.kind),
            h('td', { class: `n ${g.have ? 'warn' : 'bad'}` }, g.have),
            h('td', { class: 'n' }, g.maxNeed),
            h('td', { class: 'n' }, g.missions.length),
            h('td', { class: 'muted' }, [...new Set(g.missions)].slice(0, 3).join(', ')),
            h('td', { class: 'n' }, fix)), editRow];
        })));
    }

    // Unlocks
    body.append(h('h3', null, 'What to build next'),
      h('p', { class: 'muted' }, 'Mission types you can’t get yet because of a single building requirement.'));
    if (!r.unlocks.length) body.append(h('p', { class: 'muted' }, 'Nothing is blocked by a single building requirement.'));
    else {
      body.append(h('table', null,
        h('tr', null, h('th', null, 'Build'), h('th', { class: 'n' }, 'You have'), h('th', null, 'Unlocks')),
        r.unlocks.slice(0, 25).map((u) => h('tr', null,
          h('td', null, labelFor('prereq', u.key)),
          h('td', { class: 'n' }, u.have),
          h('td', null, u.steps.slice(0, 4).map((s) => `+${s.extra} → ${s.unlocks} mission${s.unlocks === 1 ? '' : 's'}`).join(' · '))))));
    }

    // Local weakness
    body.append(h('h3', null, 'Weak areas'),
      h('div', { class: 'row muted' }, 'Stations without enough of a vehicle type within',
        h('input', {
          type: 'number', min: 1, value: state.radiusKm,
          onchange: (e) => {
            state.radiusKm = Number(e.target.value) || 20;
            lsSet(`${MCR}radius`, state.radiusKm);
            buildReport();
            render();
          },
        }), 'km for the most demanding mission that needs it.'));
    if (!r.local.length) body.append(h('p', { class: 'ok' }, 'Every station has enough nearby for every mapped vehicle requirement.'));
    for (const x of r.local.slice(0, 20)) {
      body.append(h('details', null,
        h('summary', null, `${labelFor('vehicle', x.key)}: `, h('span', { class: x.share > 0.5 ? 'bad' : 'warn' }, `${Math.round(x.share * 100)}% of stations`), ` have fewer than ${x.need} nearby`),
        h('table', null, x.weak.slice(0, 15).map((s) => h('tr', null,
          h('td', null, s.name), h('td', { class: 'n' }, `${s.have} nearby`),
          h('td', { class: 'n' }, h('button', { class: 'btn', onclick: () => showOnMap(s.lat, s.lng) }, 'Show')))))));
    }

    // Housekeeping
    body.append(h('h3', null, 'Housekeeping'));
    const hk = [
      [`${r.understaffed.length} buildings below their personnel goal`, r.understaffed.map((b) => `${b.caption} (${b.personal_count}/${b.personal_count_goal})`)],
      [`${r.out6.length} vehicles out of service (status 6)`, r.out6.map((v) => v.caption)],
      [`${r.empty.length} stations with no vehicles`, r.empty.map((b) => b.caption)],
    ];
    for (const [title, items] of hk) {
      body.append(items.length ? h('details', null, h('summary', null, title), h('div', { class: 'muted' }, items.slice(0, 200).join(' · ')))
        : h('p', { class: 'ok' }, title.replace(/^0 /, 'No ')));
    }

    body.append(renderMappings(r));
    if (SUBSTITUTIONS[LOCALES[HOST]]) {
      body.append(h('p', { class: 'muted', style: 'margin-top:18px' },
        'Which vehicles count for each requirement comes from ',
        h('a', { href: 'https://github.com/LSS-Manager/lssm-v.4', target: '_blank', rel: 'noopener' }, 'LSS-Manager'),
        ' (CC BY-NC-SA 4.0).'));
    }
    root.replaceChildren(box);
  }

  /**
   * Chips to choose what satisfies one requirement code. Selected first, then what you own (most first), then the rest.
   * Saves your choice immediately; onApply re-runs the report.
   */
  function chipEditor(kind, key, onApply) {
    const r = state.report;
    const cands = r.maps.cands[{ req: 'veh', prereq: 'bld', edu: 'edu' }[kind]];
    const chosen = new Set((r.maps[kind][key] || []).map(String));
    const chips = h('div', { class: 'chips' });
    const sorted = cands.slice().sort((a, b) => Number(chosen.has(String(b.id))) - Number(chosen.has(String(a.id)))
      || (b.owned || 0) - (a.owned || 0) || a.caption.localeCompare(b.caption));
    for (const c of sorted) {
      const chip = h('span', {
        class: `chip${chosen.has(String(c.id)) ? ' on' : ''}`,
        title: c.owned ? `You have ${c.owned}` : 'You have none',
        onclick: () => {
          if (chosen.has(String(c.id))) chosen.delete(String(c.id));
          else chosen.add(String(c.id));
          chip.classList.toggle('on');
          state.overrides[kind] = state.overrides[kind] || {};
          state.overrides[kind][key] = [...chosen];
          lsSet(`${MCR}maps`, state.overrides);
        },
      }, c.caption, c.owned ? h('b', { style: 'margin-left:4px' }, `· ${c.owned}`) : null);
      chips.append(chip);
    }
    return h('div', { style: 'margin:6px 0' },
      h('div', { class: 'row' }, h('b', null, key),
        h('span', { class: 'muted' }, { yours: '(your choice)', lssm: '(from LSS-Manager’s data)', guess: '(guessed from names)' }[r.maps.source[kind][key]] || ''),
        r.maps.auto[kind][key] ? null : h('button', {
          class: 'btn',
          onclick: () => {
            delete state.overrides[kind][key];
            lsSet(`${MCR}maps`, state.overrides);
            buildReport();
            render();
          },
        }, 'Reset to automatic'),
        onApply ? h('button', { class: 'btn primary', onclick: onApply }, 'Apply') : null),
      chips);
  }

  function renderMappings(r) {
    const wrap = h('div', null, h('h3', null, 'How requirements were matched'),
      h('p', { class: 'muted' }, 'The mission list names requirements with internal codes. Each code was matched to your game’s names automatically; '
        + 'fix any that look wrong by clicking names on or off. Your changes are saved. Codes with nothing matched are left out of the report.'));
    const unmatched = [...r.unknown.req.map((k) => `vehicle: ${k}`), ...r.unknown.prereq.map((k) => `building: ${k}`), ...r.unknown.edu.map((k) => `training: ${k}`)];
    if (unmatched.length) wrap.append(h('p', { class: 'warn' }, `Not matched yet (${unmatched.length}): ${unmatched.join(', ')}`));
    const sections = [['req', 'Vehicle requirements'], ['prereq', 'Building requirements'], ['edu', 'Training requirements']];
    for (const [kind, title] of sections) {
      const keys = Object.keys(r.maps[kind]).sort();
      if (!keys.length) continue;
      const det = h('details', null, h('summary', null, `${title} (${keys.length})`));
      det.addEventListener('toggle', () => {
        if (!det.open || det.dataset.built) return;
        det.dataset.built = '1';
        for (const k of keys) det.append(chipEditor(kind, k));
        det.append(h('button', { class: 'btn primary', onclick: () => { buildReport(); render(); } }, 'Apply changes'));
      });
      wrap.append(det);
    }
    return wrap;
  }

  function exportReport() {
    const r = state.report;
    const data = {
      generated: r.at.toISOString(), host: HOST,
      summary: { missionTypes: r.total, unlocked: r.unlocked, fullyCovered: r.covered, buildings: r.counts.buildings, vehicles: r.counts.vehicles },
      gaps: r.gaps.map((g) => ({ kind: g.kind, key: g.key, label: labelFor(g.kind, g.key), have: g.have, upTo: g.maxNeed, missions: [...new Set(g.missions)] })),
      nextUnlocks: r.unlocks.map((u) => ({ key: u.key, label: labelFor('prereq', u.key), have: u.have, steps: u.steps })),
      weakAreas: r.local.map((x) => ({ key: x.key, need: x.need, share: x.share, stations: x.weak.map((s) => ({ name: s.name, have: s.have })) })),
      unmatched: r.unknown,
      matching: { req: r.maps.req, prereq: r.maps.prereq, edu: r.maps.edu },
    };
    download(`readiness-${HOST}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Open readiness report', open);
  // Fallback for managers without menu commands: Alt+Shift+R.
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) open();
  });
})();
