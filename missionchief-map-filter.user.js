// ==UserScript==
// @name         MissionChief Map Filter & Coverage
// @namespace    https://github.com/TroysterYT/missionchief
// @version      0.3.1
// @description  Filter your buildings on the map by type, extensions, specializations, vehicles, vehicle status, staff training and more; draw station coverage with gap analysis, and select counties or other areas to plan coverage.
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
// @grant        none
// @updateURL    https://raw.githubusercontent.com/TroysterYT/missionchief/main/missionchief-map-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/TroysterYT/missionchief/main/missionchief-map-filter.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Core: pure data + filter logic (no DOM, no Leaflet). Unit tested.   *
   * ------------------------------------------------------------------ */
  const CORE = (() => {
    const FMS_LABELS = {
      1: 'Available (radio)',
      2: 'Available at station',
      3: 'En route',
      4: 'On scene',
      5: 'Request to speak',
      6: 'Out of service',
      7: 'Transporting',
      8: 'At destination',
      9: 'Waiting',
    };

    const toNum = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

    function collectSpecs(b) {
      const out = new Set();
      const add = (v) => {
        if (v === null || v === undefined || v === '' || v === false) return;
        if (Array.isArray(v)) return v.forEach(add);
        if (typeof v === 'object') return add(v.caption ?? v.name ?? v.title);
        out.add(String(v));
      };
      add(b.specialization);
      add(b.specializations);
      add(b.specialisation);
      add(b.specialisations);
      return [...out];
    }

    function buildIndex(buildings, vehicles, staff) {
      const recs = new Map();
      for (const b of buildings || []) {
        const ext = (b.extensions || []).map((e) => ({
          caption: String(e.caption ?? `Extension ${e.type_id}`),
          available: !!e.available,
          enabled: e.enabled !== false,
        }));
        const personnel = toNum(b.personal_count) ?? 0;
        const personnelGoal = toNum(b.personal_count_goal);
        const scan = staff && staff[b.id];
        recs.set(Number(b.id), {
          id: Number(b.id),
          name: String(b.caption ?? `#${b.id}`),
          type: toNum(b.building_type),
          lat: Number(b.latitude),
          lng: Number(b.longitude),
          ext,
          specs: collectSpecs(b),
          vehicleTypes: {},
          vehicleCount: 0,
          fms: {},
          personnel,
          personnelGoal,
          understaffed: personnelGoal !== null && personnel < personnelGoal,
          level: toNum(b.level) ?? 0,
          dispatch: toNum(b.leitstelle_building_id),
          allianceShared: !!b.is_alliance_shared,
          small: !!b.small_building,
          hiring: !!b.hiring_automatic || (toNum(b.hiring_phase) ?? 0) > 0,
          trainings: scan ? scan.trainings || {} : null,
        });
      }
      for (const v of vehicles || []) {
        const r = recs.get(Number(v.building_id));
        if (!r) continue;
        const t = String(v.vehicle_type);
        r.vehicleTypes[t] = (r.vehicleTypes[t] || 0) + 1;
        r.vehicleCount++;
        const s = String(v.fms_real ?? v.fms_show ?? '?');
        r.fms[s] = (r.fms[s] || 0) + 1;
      }
      return [...recs.values()];
    }

    const countActive = (chips) => Object.values(chips || {}).filter((v) => v === 1 || v === -1).length;

    /** chips: {key: 1 (include) | -1 (exclude)}. */
    function matchChips(chips, mode, hasInc, hasExc = hasInc) {
      const inc = [];
      const exc = [];
      for (const [k, v] of Object.entries(chips || {})) {
        if (v === 1) inc.push(k);
        else if (v === -1) exc.push(k);
      }
      if (exc.some(hasExc)) return false;
      if (!inc.length) return true;
      return mode === 'all' ? inc.every(hasInc) : inc.some(hasInc);
    }

    const extOk = (e, state) =>
      state === 'enabled' ? e.available && e.enabled
        : state === 'built' ? e.available
          : state === 'construction' ? !e.available
            : true;

    const inRange = (v, r) => {
      const min = toNum(r && r.min);
      const max = toNum(r && r.max);
      return (min === null || v >= min) && (max === null || v <= max);
    };

    const flagOk = (want, v) => !want || want === 'any' || (want === 'yes') === !!v;

    function defaultFilters() {
      return {
        text: '',
        buildingTypes: {},
        extensions: { chips: {}, mode: 'any', state: 'built' },
        specs: { chips: {}, mode: 'any' },
        vehicles: { chips: {}, mode: 'any', min: 1 },
        fms: { chips: {}, mode: 'any' },
        trainings: { chips: {}, mode: 'any', min: 1 },
        dispatch: {},
        personnel: { min: null, max: null },
        level: { min: null, max: null },
        vehicleCount: { min: null, max: null },
        flags: { allianceShared: 'any', small: 'any', hiring: 'any', understaffed: 'any' },
        area: 'any',
      };
    }

    function filtersActive(f) {
      if (!f) return false;
      if ((f.text || '').trim()) return true;
      if (f.area && f.area !== 'any') return true;
      if (countActive(f.buildingTypes) || countActive(f.dispatch)) return true;
      for (const g of ['extensions', 'specs', 'vehicles', 'fms', 'trainings']) if (countActive(f[g] && f[g].chips)) return true;
      for (const g of ['personnel', 'level', 'vehicleCount']) if (f[g] && (toNum(f[g].min) !== null || toNum(f[g].max) !== null)) return true;
      return Object.values(f.flags || {}).some((v) => v && v !== 'any');
    }

    function matches(r, f) {
      const q = (f.text || '').trim().toLowerCase();
      if (q && !(r.name.toLowerCase().includes(q) || String(r.id) === q)) return false;

      if (!matchChips(f.buildingTypes, 'any', (k) => String(r.type) === k)) return false;

      const st = f.extensions.state;
      if (!matchChips(f.extensions.chips, f.extensions.mode, (k) => r.ext.some((e) => e.caption === k && extOk(e, st)))) return false;

      if (!matchChips(f.specs.chips, f.specs.mode, (k) => r.specs.includes(k))) return false;

      const vmin = Math.max(1, toNum(f.vehicles.min) ?? 1);
      if (!matchChips(f.vehicles.chips, f.vehicles.mode,
        (k) => (r.vehicleTypes[k] || 0) >= vmin,
        (k) => (r.vehicleTypes[k] || 0) > 0)) return false;

      if (!matchChips(f.fms.chips, f.fms.mode, (k) => (r.fms[k] || 0) > 0)) return false;

      if (countActive(f.trainings.chips)) {
        if (!r.trainings) return false; // staff not scanned yet: unknown, so not a match
        const tmin = Math.max(1, toNum(f.trainings.min) ?? 1);
        if (!matchChips(f.trainings.chips, f.trainings.mode,
          (k) => (r.trainings[k] || 0) >= tmin,
          (k) => (r.trainings[k] || 0) > 0)) return false;
      }

      if (!matchChips(f.dispatch, 'any', (k) => String(r.dispatch) === k)) return false;

      if (f.area === 'in' && !r.inArea) return false; // r.inArea is set by the caller from the selected areas
      if (f.area === 'out' && r.inArea) return false;

      if (!inRange(r.personnel, f.personnel)) return false;
      if (!inRange(r.level, f.level)) return false;
      if (!inRange(r.vehicleCount, f.vehicleCount)) return false;

      const fl = f.flags || {};
      return flagOk(fl.allianceShared, r.allianceShared)
        && flagOk(fl.small, r.small)
        && flagOk(fl.hiring, r.hiring)
        && flagOk(fl.understaffed, r.understaffed);
    }

    /** Count occurrences: keysFn(rec) returns [key] or [[key, weight]]. Sorted by count desc. */
    function tally(recs, keysFn) {
      const m = new Map();
      for (const r of recs) {
        for (const k of keysFn(r)) {
          const [key, w] = Array.isArray(k) ? k : [k, 1];
          if (key === null || key === undefined) continue;
          m.set(String(key), (m.get(String(key)) || 0) + w);
        }
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    }

    function distKm(lat1, lng1, lat2, lng2) {
      const R = 6371.0088;
      const toRad = Math.PI / 180;
      const dLat = (lat2 - lat1) * toRad;
      const dLng = (lng2 - lng1) * toRad;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    /** centers: [{lat, lng, r (km)}] */
    function isCovered(lat, lng, centers) {
      for (const c of centers) if (distKm(lat, lng, c.lat, c.lng) <= c.r) return true;
      return false;
    }

    /** Keep only centers whose circle can reach the bounds. */
    function centersNear(bounds, centers) {
      return centers.filter((c) => {
        const dLat = c.r / 110.574;
        const dLng = c.r / (111.32 * Math.max(0.01, Math.cos((c.lat * Math.PI) / 180)));
        return c.lat + dLat >= bounds.south && c.lat - dLat <= bounds.north
          && c.lng + dLng >= bounds.west && c.lng - dLng <= bounds.east;
      });
    }

    /** Sample an n×n grid over bounds; returns uncovered cells and covered fraction. */
    function gridCoverage(bounds, centers, n) {
      const near = centersNear(bounds, centers);
      const dLat = (bounds.north - bounds.south) / n;
      const dLng = (bounds.east - bounds.west) / n;
      const uncovered = [];
      let covered = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const s = bounds.south + i * dLat;
          const w = bounds.west + j * dLng;
          if (isCovered(s + dLat / 2, w + dLng / 2, near)) covered++;
          else uncovered.push([s, w, s + dLat, w + dLng]);
        }
      }
      return { uncovered, fraction: n > 0 ? covered / (n * n) : 0 };
    }

    /* ---- areas (counties etc.): polys = [[outerRing, ...holes], ...], rings of [lng, lat] ---- */

    /** Decode one GeometryCollection of a TopoJSON file into [{id, name, polys}]. */
    function topoFeatures(topo, objectName) {
      const tf = topo.transform;
      const arcs = topo.arcs.map((arc) => {
        let x = 0;
        let y = 0;
        return arc.map((p) => {
          if (!tf) return [p[0], p[1]];
          x += p[0];
          y += p[1];
          return [x * tf.scale[0] + tf.translate[0], y * tf.scale[1] + tf.translate[1]];
        });
      });
      const ring = (idxs) => {
        const out = [];
        idxs.forEach((i, k) => {
          const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
          for (let j = k ? 1 : 0; j < a.length; j++) out.push(a[j]);
        });
        return out;
      };
      const polys = (g) => (g.type === 'Polygon' ? [g.arcs.map(ring)]
        : g.type === 'MultiPolygon' ? g.arcs.map((p) => p.map(ring)) : []);
      const obj = topo.objects[objectName];
      return ((obj && obj.geometries) || []).map((g) => ({
        id: String(g.id),
        name: (g.properties && g.properties.name) || String(g.id),
        polys: polys(g),
      }));
    }

    function geojsonToPolys(g) {
      if (!g) return [];
      if (g.type === 'Feature') return geojsonToPolys(g.geometry);
      if (g.type === 'Polygon') return [g.coordinates];
      if (g.type === 'MultiPolygon') return g.coordinates;
      if (g.type === 'GeometryCollection') return g.geometries.flatMap(geojsonToPolys);
      return [];
    }

    function makeArea(id, name, polys) {
      const bbox = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
      for (const p of polys) {
        for (const [x, y] of p[0]) {
          if (x < bbox.west) bbox.west = x;
          if (x > bbox.east) bbox.east = x;
          if (y < bbox.south) bbox.south = y;
          if (y > bbox.north) bbox.north = y;
        }
      }
      return { id, name, polys, bbox };
    }

    function inRing(x, y, ring) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }

    function inArea(lat, lng, area) {
      const b = area.bbox;
      if (lat < b.south || lat > b.north || lng < b.west || lng > b.east) return false;
      return area.polys.some((p) => inRing(lng, lat, p[0]) && !p.slice(1).some((hole) => inRing(lng, lat, hole)));
    }

    function ringAreaKm2(ring) {
      if (ring.length < 3) return 0;
      const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
      const ky = 110.574;
      let sum = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        sum += ring[j][0] * kx * ring[i][1] * ky - ring[i][0] * kx * ring[j][1] * ky;
      }
      return Math.abs(sum / 2);
    }

    function areaKm2(area) {
      let total = 0;
      for (const p of area.polys) p.forEach((r, i) => { total += (i ? -1 : 1) * ringAreaKm2(r); });
      return total;
    }

    /** Sample an n×n grid over the area's bounding box, counting only cells whose center is inside it. */
    function areaCoverage(area, centers, n) {
      const b = area.bbox;
      const near = centersNear(b, centers);
      const dLat = (b.north - b.south) / n;
      const dLng = (b.east - b.west) / n;
      const uncovered = [];
      let inside = 0;
      let covered = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const s = b.south + i * dLat;
          const w = b.west + j * dLng;
          const lat = s + dLat / 2;
          const lng = w + dLng / 2;
          if (!inArea(lat, lng, area)) continue;
          inside++;
          if (isCovered(lat, lng, near)) covered++;
          else uncovered.push([s, w, s + dLat, w + dLng]);
        }
      }
      return { uncovered, fraction: inside ? covered / inside : 0, inside };
    }

    function toCsv(rows) {
      const esc = (v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      return rows.map((r) => r.map(esc).join(',')).join('\n');
    }

    function mergeDeep(base, over) {
      if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
      for (const [k, v] of Object.entries(over)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
          base[k] = mergeDeep(base[k], v);
        } else {
          base[k] = v;
        }
      }
      return base;
    }

    return {
      FMS_LABELS, buildIndex, matchChips, matches, filtersActive, defaultFilters, countActive,
      tally, distKm, isCovered, centersNear, gridCoverage, toCsv, mergeDeep, collectSpecs,
      topoFeatures, geojsonToPolys, makeArea, inArea, areaKm2, areaCoverage,
    };
  })();

  if (typeof module === 'object' && module.exports) {
    module.exports = CORE;
    return;
  }

  /* ------------------------------------------------------------------ *
   * Browser part                                                        *
   * ------------------------------------------------------------------ */
  if (window.top !== window.self) return;
  if (location.pathname !== '/') return;

  const HOST = location.hostname.replace(/^www\./, '');
  const PREFIX = `mcmf:${HOST}:`;
  const LOCALES = {
    'missionchief.com': 'en_US',
    'police.missionchief.com': 'en_US',
    'missionchief.co.uk': 'en_GB',
    'police.missionchief.co.uk': 'en_GB',
    'missionchief-australia.com': 'en_AU',
    'police.missionchief-australia.com': 'en_AU',
    'leitstellenspiel.de': 'de_DE',
    'polizei.leitstellenspiel.de': 'de_DE',
  };

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(PREFIX + k);
        return v === null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(PREFIX + k, JSON.stringify(v));
      } catch (e) {
        console.warn('[MCMF] could not save', k, e);
      }
    },
    del(k) {
      try {
        localStorage.removeItem(PREFIX + k);
      } catch (e) { /* ignore */ }
    },
  };

  const defaultConfig = () => ({
    filters: CORE.defaultFilters(),
    display: { mode: 'hide', highlight: true, color: '#f59e0b' },
    coverage: {
      enabled: false,
      unit: 'km',
      layers: [],
      analysisLayer: null,
      shadeGaps: false,
      markMissions: false,
      gridSize: 40,
      clipToAreas: false,
    },
    areas: { visible: true, state: '', ukRegion: 'england', pick: false, color: '#8b5cf6', opacity: 0.1, labels: true, selected: {} },
    staffScan: { delay: 350, onlyMatched: false, maxAgeHours: 24 },
    presets: {},
    ui: { open: false, tab: 'filters', sections: { types: true } },
  });

  const cfg = CORE.mergeDeep(defaultConfig(), store.get('config', {}));
  let saveTimer = null;
  const saveCfg = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      store.set('config', cfg);
    }, 300);
  };
  // Don't lose a change made just before leaving or reloading the page.
  window.addEventListener('pagehide', () => {
    if (saveTimer) store.set('config', cfg);
  });

  let data = { buildings: [], vehicles: [] };
  let index = [];
  let matched = [];
  let matchedIds = new Set();
  let meta = { b: {}, v: {} };
  let staff = store.get('staff', {});
  let loadedAt = null;
  let map = null;
  let L = null;
  let renderer = null;
  const layers = {};
  const scan = { running: false, abort: false, done: 0, total: 0, errors: 0 };
  const areaGeo = new Map(); // area id -> {id, name, polys, bbox}
  const areaNames = store.get('areaNames', {}); // area id -> label, so chips have names before geometry loads
  let atlas = null; // {states: [{id, name}], counties: [{id, name, stateId}]}
  let atlasLoading = null;
  const IS_US = LOCALES[HOST] === 'en_US';
  const IS_UK = LOCALES[HOST] === 'en_GB';

  const typeName = (id) => meta.b[String(id)] || `Building type ${id}`;
  const vehicleName = (id) => meta.v[String(id)] || `Vehicle type ${id}`;
  const fmsName = (s) => (CORE.FMS_LABELS[s] ? `${s} · ${CORE.FMS_LABELS[s]}` : `Status ${s}`);
  const unitFactor = () => (cfg.coverage.unit === 'mi' ? 1.609344 : 1);
  const byId = new Map();

  /* ---------------- helpers ---------------- */

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k in el && typeof el[k] !== 'function' && k !== 'list') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  const debounce = (fn, ms) => {
    let t = null;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function waitFor(fn, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function tick() {
        let v = null;
        try {
          v = fn();
        } catch (e) { /* not ready */ }
        if (v) return resolve(v);
        if (Date.now() - t0 > timeout) return reject(new Error('timeout'));
        setTimeout(tick, 500);
      })();
    });
  }

  async function getJSON(url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }

  function download(name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function openBuilding(id) {
    const url = `/buildings/${id}`;
    if (typeof window.lightboxOpen === 'function') window.lightboxOpen(url);
    else window.open(url, '_blank');
  }

  /* ---------------- data ---------------- */

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
    if (!obj || typeof obj !== 'object') return out;
    const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
    for (const [k, v] of entries) {
      const c = v && (v.caption || v.name);
      if (c) out[String(k)] = String(c);
    }
    return out;
  }

  async function loadMeta() {
    const cached = store.get('meta', null);
    if (cached && Date.now() - cached.ts < 24 * 3600e3) {
      meta = cached;
      return;
    }
    let locale = LOCALES[HOST];
    if (!locale) {
      const l = window.I18n && window.I18n.locale;
      locale = l && l.includes('_') ? l : 'en_US';
    }
    const base = `https://api.lss-manager.de/${locale}`;
    try {
      const [b, v] = await Promise.all([
        fetch(`${base}/buildings`).then((r) => r.json()),
        fetch(`${base}/vehicles`).then((r) => r.json()),
      ]);
      meta = { ts: Date.now(), b: captionsFrom(b), v: captionsFrom(v) };
      store.set('meta', meta);
    } catch (e) {
      console.warn('[MCMF] could not load type names from api.lss-manager.de; falling back to IDs', e);
    }
  }

  async function refreshData() {
    setStatus('Loading buildings and vehicles…');
    try {
      const [b, v] = await Promise.all([getJSON('/api/buildings'), loadVehicles()]);
      data = { buildings: Array.isArray(b) ? b : b.result || [], vehicles: v };
      loadedAt = new Date();
      rebuild();
      setStatus('');
    } catch (e) {
      console.error('[MCMF]', e);
      setStatus(`Loading failed: ${e.message}`, true);
    }
  }

  function rebuild() {
    index = CORE.buildIndex(data.buildings, data.vehicles, staff);
    byId.clear();
    for (const r of index) byId.set(r.id, r);
    apply();
    renderBody();
  }

  /* ---------------- staff scan ---------------- */

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

  async function runScan() {
    if (scan.running) return;
    const maxAge = (Number(cfg.staffScan.maxAgeHours) || 0) * 3600e3;
    const src = cfg.staffScan.onlyMatched && CORE.filtersActive(cfg.filters) ? matched : index;
    const todo = src.filter((r) => r.personnel > 0 && !(staff[r.id] && Date.now() - staff[r.id].ts < maxAge));
    Object.assign(scan, { running: true, abort: false, done: 0, total: todo.length, errors: 0 });
    renderBody();
    for (const r of todo) {
      if (scan.abort) break;
      try {
        const res = await fetch(`/buildings/${r.id}/personals`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        staff[r.id] = { ts: Date.now(), ...parsePersonnel(await res.text()) };
      } catch (e) {
        scan.errors++;
        console.warn('[MCMF] staff scan failed for', r.id, e);
      }
      scan.done++;
      if (scan.done % 10 === 0) store.set('staff', staff);
      updateScanProgress();
      await sleep(Math.max(100, Number(cfg.staffScan.delay) || 350));
    }
    scan.running = false;
    store.set('staff', staff);
    rebuild();
  }

  /* ---------------- filtering + map ---------------- */

  function apply() {
    const sel = selectedAreas();
    for (const r of index) r.inArea = sel.some((a) => CORE.inArea(r.lat, r.lng, a));
    const active = CORE.filtersActive(cfg.filters);
    matched = active ? index.filter((r) => CORE.matches(r, cfg.filters)) : index.slice();
    matchedIds = new Set(matched.map((r) => r.id));
    applyMarkers();
    drawHighlights();
    drawCoverage();
    updateSummary();
    saveCfg();
  }
  const applySoon = debounce(apply, 120);

  function applyMarkers() {
    const ms = window.building_markers;
    if (!Array.isArray(ms)) return;
    const active = CORE.filtersActive(cfg.filters) && index.length > 0;
    const mode = cfg.display.mode;
    for (const m of ms) {
      const el = (m.getElement && m.getElement()) || m._icon;
      if (!el) continue;
      const id = Number(m.building_id ?? (m.options && m.options.building_id));
      let display = '';
      let opacity = '';
      if (active && Number.isFinite(id) && byId.has(id) && !matchedIds.has(id)) {
        if (mode === 'hide') display = 'none';
        else if (mode === 'dim') opacity = '0.2';
      }
      el.style.display = display;
      el.style.opacity = opacity;
      if (m._shadow) m._shadow.style.display = display;
    }
  }

  function popupFor(r) {
    const vt = Object.entries(r.vehicleTypes).sort((a, b) => b[1] - a[1]);
    const ext = r.ext.filter((e) => e.available).map((e) => e.caption + (e.enabled ? '' : ' (off)'));
    const building = r.ext.filter((e) => !e.available).map((e) => e.caption);
    const tr = r.trainings ? Object.entries(r.trainings).sort((a, b) => b[1] - a[1]) : null;
    const row = (k, v) => h('div', { class: 'mcmf-pop-row' }, h('b', null, k), ' ', v);
    return h('div', { class: 'mcmf-pop' },
      h('a', { href: `/buildings/${r.id}`, onclick: (e) => { e.preventDefault(); openBuilding(r.id); } }, r.name),
      h('div', { class: 'mcmf-muted' }, typeName(r.type), r.level ? ` · level ${r.level}` : ''),
      row('Personnel:', `${r.personnel}${r.personnelGoal !== null ? ` / ${r.personnelGoal}` : ''}`),
      vt.length ? row(`Vehicles (${r.vehicleCount}):`, vt.map(([k, n]) => `${n}× ${vehicleName(k)}`).join(', ')) : null,
      ext.length ? row('Extensions:', ext.join(', ')) : null,
      building.length ? row('Under construction:', building.join(', ')) : null,
      r.specs.length ? row('Specialization:', r.specs.join(', ')) : null,
      tr ? row('Training:', tr.length ? tr.map(([k, n]) => `${n}× ${k}`).join(', ') : 'none') : null);
  }

  function drawHighlights() {
    if (!layers.hl) return;
    layers.hl.clearLayers();
    if (!cfg.display.highlight || !CORE.filtersActive(cfg.filters)) return;
    for (const r of matched) {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
      L.circleMarker([r.lat, r.lng], {
        renderer, radius: 11, color: cfg.display.color, weight: 3, fillOpacity: 0.12,
      }).bindPopup(() => popupFor(r)).addTo(layers.hl);
    }
  }

  function layerCenters(layer) {
    let src;
    if (layer.source === 'filter') src = matched;
    else if (layer.source === 'vehicles') {
      const keys = Object.keys(layer.vehicles || {}).filter((k) => layer.vehicles[k] === 1);
      src = index.filter((r) => keys.some((k) => (r.vehicleTypes[k] || 0) > 0));
    } else {
      const keys = Object.keys(layer.types || {}).filter((k) => layer.types[k] === 1);
      src = index.filter((r) => keys.includes(String(r.type)));
    }
    const rKm = (Number(layer.radius) || 0) * unitFactor();
    return src.filter((r) => Number.isFinite(r.lat)).map((r) => ({ lat: r.lat, lng: r.lng, r: rKm }));
  }

  function drawCoverage() {
    if (!layers.cov) return;
    layers.cov.clearLayers();
    if (cfg.coverage.enabled) {
      for (const layer of cfg.coverage.layers) {
        if (!layer.visible) continue;
        for (const c of layerCenters(layer)) {
          L.circle([c.lat, c.lng], {
            renderer, radius: c.r * 1000, color: layer.color, weight: 1, opacity: 0.6,
            fillColor: layer.color, fillOpacity: Number(layer.opacity) || 0.12, interactive: false,
          }).addTo(layers.cov);
        }
      }
    }
    drawAnalysis();
  }

  let lastStats = '';
  function drawAnalysis() {
    if (!layers.gap) return;
    layers.gap.clearLayers();
    layers.miss.clearLayers();
    lastStats = '';
    const c = cfg.coverage;
    const layer = c.layers.find((l) => l.id === c.analysisLayer);
    if (!c.enabled || !layer || (!c.shadeGaps && !c.markMissions)) {
      updateCoverageStats();
      return;
    }
    const centers = layerCenters(layer);
    const b = map.getBounds();
    const bounds = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    const parts = [];
    if (c.shadeGaps) {
      const n = Math.min(120, Math.max(10, Number(c.gridSize) || 40));
      const shade = (cells) => {
        for (const [s, w, nn, e] of cells) {
          L.rectangle([[s, w], [nn, e]], {
            renderer, stroke: false, fillColor: '#e11d48', fillOpacity: 0.22, interactive: false,
          }).addTo(layers.gap);
        }
      };
      const sel = c.clipToAreas ? selectedAreas() : [];
      if (sel.length) {
        let total = 0;
        let covered = 0;
        for (const area of sel) {
          const res = CORE.areaCoverage(area, centers, n);
          const size = CORE.areaKm2(area); // weight by size: every area gets the same number of samples
          total += size;
          covered += res.fraction * size;
          shade(res.uncovered);
        }
        parts.push(`${total ? Math.round((covered / total) * 100) : 0}% of the selected areas is inside “${layer.name}” coverage`);
      } else {
        const res = CORE.gridCoverage(bounds, centers, n);
        shade(res.uncovered);
        parts.push(`${Math.round(res.fraction * 100)}% of the visible map is inside “${layer.name}” coverage`);
      }
    }
    if (c.markMissions) {
      const ms = Array.isArray(window.mission_markers) ? window.mission_markers : [];
      const near = CORE.centersNear(bounds, centers);
      let outside = 0;
      let visible = 0;
      for (const m of ms) {
        if (!m.getLatLng) continue;
        const ll = m.getLatLng();
        if (!b.contains(ll)) continue;
        visible++;
        if (CORE.isCovered(ll.lat, ll.lng, near)) continue;
        outside++;
        L.circleMarker(ll, {
          renderer, radius: 16, color: '#e11d48', weight: 3, dashArray: '4 4', fill: false,
        }).bindTooltip(`Outside “${layer.name}” coverage`).addTo(layers.miss);
      }
      parts.push(`${outside} of ${visible} visible missions are outside coverage`);
    }
    lastStats = parts.join(' · ');
    updateCoverageStats();
  }

  /* ---------------- areas (counties & custom boundaries) ---------------- */

  const ATLAS_URLS = [
    'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json',
    'https://unpkg.com/us-atlas@3/counties-10m.json',
  ];
  const STATE_ABBR = {
    '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', 10: 'DE', 11: 'DC', 12: 'FL',
    13: 'GA', 15: 'HI', 16: 'ID', 17: 'IL', 18: 'IN', 19: 'IA', 20: 'KS', 21: 'KY', 22: 'LA', 23: 'ME', 24: 'MD',
    25: 'MA', 26: 'MI', 27: 'MN', 28: 'MS', 29: 'MO', 30: 'MT', 31: 'NE', 32: 'NV', 33: 'NH', 34: 'NJ', 35: 'NM',
    36: 'NY', 37: 'NC', 38: 'ND', 39: 'OH', 40: 'OK', 41: 'OR', 42: 'PA', 44: 'RI', 45: 'SC', 46: 'SD', 47: 'TN',
    48: 'TX', 49: 'UT', 50: 'VT', 51: 'VA', 53: 'WA', 54: 'WV', 55: 'WI', 56: 'WY', 72: 'PR',
  };
  let areaRenderer = null;
  let osmResults = [];

  const areaLabel = (id) => (areaGeo.get(id) || {}).name || areaNames[id] || id;
  const selectedAreas = () => Object.keys(cfg.areas.selected).map((id) => areaGeo.get(id)).filter(Boolean);
  const areaUnit = () => (cfg.coverage.unit === 'mi' ? ['mi²', 1 / 2.589988] : ['km²', 1]);

  function loadAtlas() {
    if (atlas) return Promise.resolve(atlas);
    if (!atlasLoading) {
      atlasLoading = (async () => {
        let topo = null;
        let lastErr = null;
        for (const u of ATLAS_URLS) {
          try {
            const r = await fetch(u);
            if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
            topo = await r.json();
            break;
          } catch (e) {
            lastErr = e;
          }
        }
        if (!topo) throw lastErr;
        const states = CORE.topoFeatures(topo, 'states');
        for (const s of states) areaGeo.set(`us-state:${s.id}`, CORE.makeArea(`us-state:${s.id}`, s.name, s.polys));
        const stateName = Object.fromEntries(states.map((s) => [s.id, s.name]));
        const counties = CORE.topoFeatures(topo, 'counties').map((c) => {
          const stateId = c.id.slice(0, 2);
          const id = `us:${c.id}`;
          const label = `${c.name}, ${STATE_ABBR[stateId] || stateName[stateId] || stateId}`;
          areaGeo.set(id, CORE.makeArea(id, label, c.polys));
          return { id, name: c.name, label, stateId };
        });
        atlas = {
          states: states.map((s) => ({ id: s.id, name: s.name })).sort((x, y) => x.name.localeCompare(y.name)),
          counties,
        };
        return atlas;
      })();
      atlasLoading.catch(() => { atlasLoading = null; });
    }
    return atlasLoading;
  }

  function detectState() {
    if (!atlas) return '';
    const c = map.getCenter();
    const s = atlas.states.find((st) => CORE.inArea(c.lat, c.lng, areaGeo.get(`us-state:${st.id}`)));
    return s ? s.id : '';
  }

  function saveCustomAreas() {
    const out = {};
    for (const id of Object.keys(cfg.areas.selected)) {
      if (!id.startsWith('osm:')) continue;
      const a = areaGeo.get(id);
      if (a) out[id] = { name: a.name, polys: a.polys };
    }
    store.set('areaGeo', out);
    const names = {};
    for (const id of Object.keys(cfg.areas.selected)) names[id] = areaLabel(id);
    store.set('areaNames', names);
  }

  function areasChanged() {
    saveCustomAreas();
    drawAreas();
    apply();
  }

  /** Show or hide the area outlines. Filters, stats and gap shading still use the selected areas. */
  function setAreasVisible(v) {
    cfg.areas.visible = v;
    if (!v) cfg.areas.pick = false;
    drawAreas();
    saveCfg();
    if (cfg.ui.tab === 'areas') renderBody();
  }

  let areasBtn = null;
  function updateAreasButton() {
    if (!areasBtn) return;
    areasBtn.classList.toggle('mcmf-on', !!cfg.areas.visible);
    areasBtn.title = cfg.areas.visible ? 'Hide county outlines' : 'Show county outlines';
  }

  function toggleArea(id) {
    if (cfg.areas.selected[id]) delete cfg.areas.selected[id];
    else cfg.areas.selected[id] = 1;
    areasChanged();
    if (cfg.ui.tab === 'areas') renderBody();
  }

  const toLatLngs = (polys) => polys.map((p) => p.map((ring) => ring.map(([x, y]) => [y, x])));

  function drawAreas() {
    if (!layers.areas) return;
    layers.areas.clearLayers();
    const a = cfg.areas;
    // Below coverage/gap shading normally; above it (still below markers) while picking so clicks reach the counties.
    map.getPane('mcmfAreas').style.zIndex = a.pick ? 450 : 390;
    updateAreasButton();
    if (!a.visible) return;
    const selFill = Math.max(Number(a.opacity) || 0, 0.15);
    const picked = new Set();
    if (a.pick) {
      for (const c of pickItems()) {
        picked.add(c.id);
        const isSel = () => !!a.selected[c.id];
        const style = () => ({
          color: a.color, weight: isSel() ? 2.5 : 1, opacity: isSel() ? 0.95 : 0.55, fillColor: a.color, fillOpacity: isSel() ? selFill : 0.03,
        });
        const poly = L.polygon(toLatLngs(areaGeo.get(c.id).polys), { renderer: areaRenderer, ...style() });
        poly.bindTooltip(c.label, { sticky: true });
        poly.on('mouseover', () => poly.setStyle({ fillOpacity: 0.3 }));
        poly.on('mouseout', () => poly.setStyle(style()));
        poly.on('click', (e) => {
          L.DomEvent.stop(e);
          toggleArea(c.id);
        });
        poly.addTo(layers.areas);
      }
    }
    for (const geo of selectedAreas()) {
      if (picked.has(geo.id)) continue;
      const poly = L.polygon(toLatLngs(geo.polys), {
        renderer: areaRenderer, interactive: false, color: a.color, weight: 2.5, opacity: 0.95, fillColor: a.color, fillOpacity: Number(a.opacity) || 0,
      });
      if (a.labels) poly.bindTooltip(geo.name, { permanent: true, direction: 'center', className: 'mcmf-label' });
      poly.addTo(layers.areas);
    }
  }

  /* ---- UK counties: fixed lists, boundaries fetched from OpenStreetMap on demand and cached ---- */

  // [label, search text (defaults to label)]
  const UK_REGIONS = {
    england: {
      title: 'England – ceremonial counties', nation: 'England', prefer: 'ceremonial',
      items: ['Bedfordshire', 'Berkshire', ['Bristol', 'City of Bristol'], 'Buckinghamshire', 'Cambridgeshire', 'Cheshire',
        'City of London', 'Cornwall', 'Cumbria', 'Derbyshire', 'Devon', 'Dorset', ['Durham', 'County Durham'],
        'East Riding of Yorkshire', 'East Sussex', 'Essex', 'Gloucestershire', 'Greater London', 'Greater Manchester',
        'Hampshire', 'Herefordshire', 'Hertfordshire', 'Isle of Wight', 'Kent', 'Lancashire', 'Leicestershire',
        'Lincolnshire', 'Merseyside', 'Norfolk', 'North Yorkshire', 'Northamptonshire', 'Northumberland',
        'Nottinghamshire', 'Oxfordshire', 'Rutland', 'Shropshire', 'Somerset', 'South Yorkshire', 'Staffordshire',
        'Suffolk', 'Surrey', 'Tyne and Wear', 'Warwickshire', 'West Midlands', 'West Sussex', 'West Yorkshire',
        'Wiltshire', 'Worcestershire'],
    },
    wales: {
      title: 'Wales – principal areas', nation: 'Wales', prefer: 'administrative',
      items: ['Blaenau Gwent', ['Bridgend', 'Bridgend County Borough'], ['Caerphilly', 'Caerphilly County Borough'], 'Cardiff',
        'Carmarthenshire', 'Ceredigion', ['Conwy', 'Conwy County Borough'], 'Denbighshire', 'Flintshire', 'Gwynedd',
        'Isle of Anglesey', ['Merthyr Tydfil', 'Merthyr Tydfil County Borough'], 'Monmouthshire', 'Neath Port Talbot',
        ['Newport', 'City of Newport'], 'Pembrokeshire', 'Powys', 'Rhondda Cynon Taf', ['Swansea', 'City and County of Swansea'],
        'Torfaen', 'Vale of Glamorgan', ['Wrexham', 'Wrexham County Borough']],
    },
    scotland: {
      title: 'Scotland – council areas', nation: 'Scotland', prefer: 'administrative',
      items: ['Aberdeen City', 'Aberdeenshire', 'Angus', 'Argyll and Bute', 'City of Edinburgh', 'Clackmannanshire',
        'Dumfries and Galloway', 'Dundee City', 'East Ayrshire', 'East Dunbartonshire', 'East Lothian', 'East Renfrewshire',
        'Falkirk', 'Fife', 'Glasgow City', 'Highland', 'Inverclyde', 'Midlothian', 'Moray', 'Na h-Eileanan Siar',
        'North Ayrshire', 'North Lanarkshire', 'Orkney Islands', 'Perth and Kinross', 'Renfrewshire', 'Scottish Borders',
        'Shetland Islands', 'South Ayrshire', 'South Lanarkshire', 'Stirling', 'West Dunbartonshire', 'West Lothian'],
    },
    ni: {
      title: 'Northern Ireland – counties', nation: 'Northern Ireland', prefer: 'ceremonial',
      items: [['Antrim', 'County Antrim'], ['Armagh', 'County Armagh'], ['Down', 'County Down'], ['Fermanagh', 'County Fermanagh'],
        ['Londonderry', 'County Londonderry'], ['Tyrone', 'County Tyrone']],
    },
  };
  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  function ukList(region) {
    const r = UK_REGIONS[region];
    if (!r) return [];
    return r.items.map((it) => {
      const [label, query] = Array.isArray(it) ? it : [it, it];
      return { id: `uk:${region}:${slug(label)}`, label, query, region };
    });
  }

  /** Items shown as clickable outlines in pick mode (only those whose boundary is loaded). */
  function pickItems() {
    const a = cfg.areas;
    if (IS_UK) return ukList(a.ukRegion).filter((c) => areaGeo.has(c.id));
    if (atlas && a.state) return atlas.counties.filter((c) => c.stateId === a.state);
    return [];
  }

  // OpenStreetMap's Nominatim allows at most one request per second, so all calls go through this queue.
  let nominatimChain = Promise.resolve();
  function nominatim(url) {
    const run = nominatimChain.then(async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`OpenStreetMap search: HTTP ${r.status}`);
      return r.json();
    });
    nominatimChain = run.catch(() => {}).then(() => sleep(1100));
    return run;
  }

  // Boundary cache in IndexedDB (too big for localStorage, which the game and other scripts share).
  const areaDb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('mcmf-areas', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('areas', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction('areas', mode);
        const req = fn(t.objectStore('areas'));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
      });
    };
    return {
      all: () => run('readonly', (st) => st.getAll()).catch(() => []),
      put: (v) => run('readwrite', (st) => st.put(v)).catch((e) => console.warn('[MCMF] could not cache boundary', e)),
      clear: () => run('readwrite', (st) => st.clear()).catch(() => {}),
    };
  })();

  const ukPending = new Map();
  /** Load one UK county boundary: memory → IndexedDB (preloaded at boot) → OpenStreetMap. */
  function ensureUkArea(item) {
    if (areaGeo.has(item.id)) return Promise.resolve(areaGeo.get(item.id));
    if (ukPending.has(item.id)) return ukPending.get(item.id);
    const reg = UK_REGIONS[item.region];
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&polygon_threshold=0.002'
      + `&countrycodes=gb&limit=8&accept-language=en&q=${encodeURIComponent(`${item.query}, ${reg.nation}`)}`;
    const p = nominatim(url).then((list) => {
      const want = item.label.toLowerCase();
      const scored = list
        .filter((x) => x.geojson && /Polygon/.test(x.geojson.type))
        .map((x) => {
          const cls = x.category || x.class;
          const name = String(x.name || '').toLowerCase();
          let score = 0;
          if (cls === 'boundary') score += 4;
          if (x.type === reg.prefer) score += 2;
          if (name === want || name === item.query.toLowerCase()) score += 3;
          else if (name.includes(want)) score += 1;
          return { x, score };
        })
        .sort((a, b) => b.score - a.score);
      if (!scored.length) throw new Error(`no boundary found for ${item.label}`);
      const area = CORE.makeArea(item.id, item.label, CORE.geojsonToPolys(scored[0].x.geojson));
      areaGeo.set(item.id, area);
      areaDb.put({ id: item.id, name: item.label, polys: area.polys });
      return area;
    }).finally(() => ukPending.delete(item.id));
    ukPending.set(item.id, p);
    return p;
  }

  const ukLoad = { running: false, done: 0, total: 0, failed: [] };
  async function loadUkItems(items) {
    const todo = items.filter((c) => !areaGeo.has(c.id));
    if (!todo.length || ukLoad.running) return;
    Object.assign(ukLoad, { running: true, done: 0, total: todo.length, failed: [] });
    if (cfg.ui.tab === 'areas') renderBody();
    for (const c of todo) {
      try {
        await ensureUkArea(c);
      } catch (e) {
        ukLoad.failed.push(c.label);
        delete cfg.areas.selected[c.id];
      }
      ukLoad.done++;
      const el = document.getElementById('mcmf-ukload');
      if (el) el.textContent = `Loading boundaries… ${ukLoad.done} / ${ukLoad.total}`;
      drawAreas();
    }
    ukLoad.running = false;
    areasChanged();
    if (cfg.ui.tab === 'areas') renderBody();
  }

  async function searchOsm(q) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&polygon_threshold=0.0005'
      + `&limit=10&accept-language=en&q=${encodeURIComponent(q)}`;
    const list = await nominatim(url);
    return list
      .filter((x) => x.geojson && /Polygon/.test(x.geojson.type))
      .map((x) => ({
        id: `osm:${x.osm_type}:${x.osm_id}`,
        name: x.display_name.split(',').slice(0, 2).map((s) => s.trim()).join(', '),
        full: x.display_name,
        kind: x.addresstype || x.type || '',
        polys: CORE.geojsonToPolys(x.geojson),
      }));
  }

  function zoomToArea(geo) {
    const b = geo.bbox;
    map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [20, 20] });
  }

  function areaStats(geo) {
    const inside = index.filter((r) => CORE.inArea(r.lat, r.lng, geo));
    const missions = (Array.isArray(window.mission_markers) ? window.mission_markers : [])
      .filter((m) => m.getLatLng && CORE.inArea(m.getLatLng().lat, m.getLatLng().lng, geo)).length;
    const layer = cfg.coverage.layers.find((l) => l.id === cfg.coverage.analysisLayer);
    const coverage = layer ? CORE.areaCoverage(geo, layerCenters(layer), 50).fraction : null;
    return {
      inside, missions, coverage, layer,
      types: CORE.tally(inside, (r) => [r.type]),
      size: CORE.areaKm2(geo),
    };
  }

  /* ---------------- UI ---------------- */

  const CSS = `
  #mcmf-panel{--bg:#ffffff;--fg:#1f2430;--muted:#6b7280;--line:#dde1e8;--chip:#f1f3f7;--accent:#2563eb;--inc:#15803d;--inc-bg:#dcfce7;--exc:#b91c1c;--exc-bg:#fee2e2;
    position:fixed;top:64px;right:12px;width:380px;max-width:calc(100vw - 24px);max-height:calc(100vh - 80px);display:flex;flex-direction:column;
    background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);z-index:10000;font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  #mcmf-panel.mcmf-dark{--bg:#1e2228;--fg:#e6e8ec;--muted:#9aa3b2;--line:#353b45;--chip:#2a2f37;--accent:#60a5fa;--inc:#86efac;--inc-bg:#14532d;--exc:#fca5a5;--exc-bg:#7f1d1d}
  #mcmf-panel[hidden]{display:none}
  #mcmf-panel *{box-sizing:border-box}
  .mcmf-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}
  .mcmf-head h3{margin:0;font-size:14px;font-weight:600;flex:1;color:var(--fg)}
  .mcmf-x{background:none;border:0;color:var(--muted);font-size:18px;cursor:pointer;line-height:1}
  .mcmf-tabs{display:flex;border-bottom:1px solid var(--line)}
  .mcmf-tabs button{flex:1;background:none;border:0;border-bottom:2px solid transparent;padding:8px 4px;color:var(--muted);cursor:pointer;font:inherit}
  .mcmf-tabs button.on{color:var(--fg);border-bottom-color:var(--accent);font-weight:600}
  .mcmf-summary{padding:8px 12px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:6px}
  .mcmf-count{font-weight:600}
  .mcmf-body{overflow:auto;padding:8px 12px 12px;flex:1}
  .mcmf-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  label.mcmf-row{flex-wrap:nowrap}
  .mcmf-muted{color:var(--muted);font-size:12px}
  .mcmf-err{color:var(--exc)}
  .mcmf-input,.mcmf-sel,#mcmf-panel input[type=number]{background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:4px 6px;font:inherit;min-width:0}
  .mcmf-input{width:100%}
  #mcmf-panel input[type=number]{width:72px}
  .mcmf-btn{background:var(--chip);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:4px 9px;cursor:pointer;font:inherit}
  .mcmf-btn:hover{border-color:var(--accent)}
  .mcmf-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .mcmf-btn:disabled{opacity:.5;cursor:default}
  #mcmf-panel details{border-bottom:1px solid var(--line);padding:6px 0}
  #mcmf-panel summary{cursor:pointer;font-weight:600;display:flex;align-items:center;gap:6px;list-style:none;padding:2px 0}
  #mcmf-panel summary::-webkit-details-marker{display:none}
  #mcmf-panel summary::before{content:"▸";color:var(--muted);width:10px}
  #mcmf-panel details[open]>summary::before{content:"▾"}
  .mcmf-badge{background:var(--accent);color:#fff;border-radius:9px;padding:0 6px;font-size:11px;font-weight:600}
  .mcmf-badge:empty{display:none}
  .mcmf-sec{display:flex;flex-direction:column;gap:6px;padding:6px 0 2px}
  .mcmf-chips{display:flex;flex-wrap:wrap;gap:4px;max-height:220px;overflow:auto}
  .mcmf-chip{border:1px solid var(--line);background:var(--chip);color:var(--fg);border-radius:14px;padding:2px 8px;cursor:pointer;font:inherit;font-size:12px;user-select:none}
  .mcmf-chip small{color:var(--muted);margin-left:4px}
  .mcmf-chip.inc{background:var(--inc-bg);border-color:var(--inc);color:var(--inc)}
  .mcmf-chip.exc{background:var(--exc-bg);border-color:var(--exc);color:var(--exc);text-decoration:line-through}
  .mcmf-card{border:1px solid var(--line);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px;margin:8px 0}
  .mcmf-bar{height:6px;background:var(--chip);border-radius:3px;overflow:hidden}
  .mcmf-bar>div{height:100%;background:var(--accent);width:0}
  .mcmf-grid2{display:grid;grid-template-columns:auto 1fr;gap:6px 8px;align-items:center}
  .mcmf-pop{font-size:12px;max-width:280px}
  .mcmf-pop>a{font-weight:600;font-size:13px}
  .mcmf-pop-row{margin-top:3px}
  .mcmf-ctl a{display:flex!important;align-items:center;justify-content:center;color:#9ca3af}
  .mcmf-ctl a:first-child,.mcmf-ctl a.mcmf-on{color:#6d28d9}
  .leaflet-tooltip.mcmf-label{background:rgba(255,255,255,.8);border:0;box-shadow:none;font-weight:600;padding:1px 5px;color:#3b0764}
  .leaflet-tooltip.mcmf-label::before{display:none}
  .mcmf-stat{font-size:12px;color:var(--muted)}
  .mcmf-stat b{color:var(--fg)}
  `;

  let panel;
  let bodyEl;
  let summaryEl;
  let statusEl;
  let statusMsg = { text: '', err: false };
  const badges = [];

  function isDark() {
    if (document.body.classList.contains('dark')) return true;
    const rgb = (getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g) || []).map(Number);
    if (rgb.length < 3 || rgb[3] === 0) return false;
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 110;
  }

  function setStatus(text, err = false) {
    statusMsg = { text, err };
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.className = err ? 'mcmf-muted mcmf-err' : 'mcmf-muted';
    }
  }

  function buildPanel() {
    document.head.append(h('style', null, CSS));
    panel = h('div', { id: 'mcmf-panel', class: isDark() ? 'mcmf-dark' : '' });
    panel.hidden = !cfg.ui.open;
    const tabs = h('div', { class: 'mcmf-tabs' });
    for (const [key, label] of [['filters', 'Filters'], ['coverage', 'Coverage'], ['areas', 'Areas'], ['staff', 'Staff'], ['presets', 'Presets']]) {
      tabs.append(h('button', {
        class: cfg.ui.tab === key ? 'on' : '',
        'data-tab': key,
        onclick: () => {
          cfg.ui.tab = key;
          tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === key));
          saveCfg();
          renderBody();
        },
      }, label));
    }
    summaryEl = h('div', { class: 'mcmf-summary' });
    bodyEl = h('div', { class: 'mcmf-body' });
    panel.append(
      h('div', { class: 'mcmf-head' },
        h('h3', null, 'Map filter & coverage'),
        h('button', { class: 'mcmf-x', title: 'Close', onclick: () => togglePanel(false) }, '×')),
      tabs, summaryEl, bodyEl);
    document.body.append(panel);
    renderSummary();
    renderBody();
  }

  function togglePanel(force) {
    cfg.ui.open = typeof force === 'boolean' ? force : !cfg.ui.open;
    panel.hidden = !cfg.ui.open;
    if (cfg.ui.open) panel.classList.toggle('mcmf-dark', isDark());
    saveCfg();
  }

  function renderSummary() {
    summaryEl.replaceChildren(
      h('div', { class: 'mcmf-row' },
        h('span', { class: 'mcmf-count', id: 'mcmf-count' }),
        h('span', { style: 'flex:1' }),
        h('button', { class: 'mcmf-btn', title: 'Reload buildings and vehicles from the game', onclick: refreshData }, '⟳ Refresh')),
      h('div', { class: 'mcmf-row' },
        h('label', { class: 'mcmf-muted' }, 'Non-matching:'),
        select(cfg.display, 'mode', [['hide', 'Hide'], ['dim', 'Dim'], ['none', 'Leave as is']], apply),
        h('label', { class: 'mcmf-row mcmf-muted' },
          h('input', { type: 'checkbox', checked: cfg.display.highlight, onchange: (e) => { cfg.display.highlight = e.target.checked; apply(); } }),
          'Ring matches'),
        h('input', { type: 'color', value: cfg.display.color, title: 'Ring color', style: 'width:28px;height:22px;padding:0;border:0;background:none', oninput: (e) => { cfg.display.color = e.target.value; applySoon(); } })),
      h('div', { class: 'mcmf-row' },
        h('button', { class: 'mcmf-btn', onclick: zoomToMatches }, 'Zoom to matches'),
        h('button', { class: 'mcmf-btn', onclick: exportCsv }, 'Export CSV'),
        h('button', { class: 'mcmf-btn', onclick: resetFilters }, 'Reset filters')),
      statusEl = h('div', { class: statusMsg.err ? 'mcmf-muted mcmf-err' : 'mcmf-muted' }, statusMsg.text));
    updateSummary();
  }

  function updateSummary() {
    const el = document.getElementById('mcmf-count');
    if (el) {
      el.textContent = !index.length ? 'No data loaded yet'
        : CORE.filtersActive(cfg.filters) ? `${matched.length} of ${index.length} buildings match`
          : `${index.length} buildings · no filters`;
    }
    for (const { el: b, fn } of badges) {
      const n = fn();
      b.textContent = n ? String(n) : '';
    }
  }

  function select(obj, key, options, onChange) {
    return h('select', {
      class: 'mcmf-sel',
      onchange: (e) => {
        obj[key] = e.target.value;
        onChange();
      },
    }, options.map(([v, label]) => h('option', { value: v, selected: String(obj[key]) === String(v) }, label)));
  }

  function numInput(obj, key, { placeholder = '', min, step, onChange = applySoon } = {}) {
    return h('input', {
      type: 'number', placeholder, min, step,
      value: obj[key] === null || obj[key] === undefined ? '' : obj[key],
      oninput: (e) => {
        obj[key] = e.target.value === '' ? null : Number(e.target.value);
        onChange();
      },
    });
  }

  function section(key, title, activeFn, ...content) {
    const d = h('details', {
      open: !!cfg.ui.sections[key],
      ontoggle: () => {
        cfg.ui.sections[key] = d.open;
        saveCfg();
      },
    });
    const badge = h('span', { class: 'mcmf-badge' });
    if (activeFn) badges.push({ el: badge, fn: activeFn });
    d.append(h('summary', null, title, badge), h('div', { class: 'mcmf-sec' }, content));
    return d;
  }

  /**
   * items: [{key, label, count}], state: {key: 1|-1}. Click cycles off → include → exclude → off;
   * right-click jumps straight to exclude. tri=false gives include-only chips.
   */
  function chipGroup(items, state, { tri = true, onChange = applySoon, empty = 'Nothing to show yet.' } = {}) {
    if (!items.length) return h('div', { class: 'mcmf-muted' }, empty);
    const paint = (el, key) => {
      el.classList.toggle('inc', state[key] === 1);
      el.classList.toggle('exc', state[key] === -1);
    };
    const set = (key, v, el) => {
      if (v) state[key] = v;
      else delete state[key];
      paint(el, key);
      onChange();
    };
    const wrap = h('div', { class: 'mcmf-chips' });
    const sorted = items.slice().sort((a, b) => a.label.localeCompare(b.label));
    for (const it of sorted) {
      const el = h('button', {
        class: 'mcmf-chip',
        title: tri ? 'Click: include → exclude → off. Right-click: exclude.' : 'Click to toggle',
        onclick: () => {
          const cur = state[it.key];
          set(it.key, !cur ? 1 : cur === 1 && tri ? -1 : 0, el);
        },
        oncontextmenu: (e) => {
          if (!tri) return;
          e.preventDefault();
          set(it.key, state[it.key] === -1 ? 0 : -1, el);
        },
      }, it.label, it.count !== undefined ? h('small', null, it.count) : null);
      el.dataset.label = it.label.toLowerCase();
      paint(el, it.key);
      wrap.append(el);
    }
    if (items.length <= 12) return wrap;
    const search = h('input', {
      type: 'search', class: 'mcmf-input', placeholder: `Search ${items.length} options…`,
      oninput: (e) => {
        const q = e.target.value.trim().toLowerCase();
        for (const c of wrap.children) c.style.display = !q || c.dataset.label.includes(q) ? '' : 'none';
      },
    });
    return h('div', { class: 'mcmf-sec' }, search, wrap);
  }

  const modeSel = (obj) => select(obj, 'mode', [['any', 'Match any'], ['all', 'Match all']], applySoon);
  const flagSel = (label, key) => [
    h('span', null, label),
    select(cfg.filters.flags, key, [['any', 'Any'], ['yes', 'Yes'], ['no', 'No']], applySoon),
  ];
  const range = (label, obj) => [
    h('span', null, label),
    h('div', { class: 'mcmf-row' }, numInput(obj, 'min', { placeholder: 'min' }), '–', numInput(obj, 'max', { placeholder: 'max' })),
  ];

  function renderBody() {
    if (!bodyEl) return;
    badges.length = 0;
    const scrollTop = bodyEl.scrollTop;
    bodyEl.replaceChildren();
    const tab = cfg.ui.tab;
    if (!index.length && tab !== 'presets' && tab !== 'areas') {
      bodyEl.append(h('div', { class: 'mcmf-muted' }, 'Loading your buildings… If this stays empty, press Refresh.'));
    } else if (tab === 'filters') renderFilters();
    else if (tab === 'coverage') renderCoverage();
    else if (tab === 'areas') renderAreas();
    else if (tab === 'staff') renderStaff();
    else renderPresets();
    bodyEl.scrollTop = scrollTop;
    updateSummary();
  }

  function renderFilters() {
    const f = cfg.filters;
    const ca = CORE.countActive;
    const typeItems = CORE.tally(index, (r) => [r.type]).map(([k, n]) => ({ key: k, label: typeName(k), count: n }));
    const extItems = CORE.tally(index, (r) => [...new Set(r.ext.map((e) => e.caption))]).map(([k, n]) => ({ key: k, label: k, count: n }));
    const specItems = CORE.tally(index, (r) => r.specs).map(([k, n]) => ({ key: k, label: k, count: n }));
    const vehItems = CORE.tally(index, (r) => Object.entries(r.vehicleTypes)).map(([k, n]) => ({ key: k, label: vehicleName(k), count: n }));
    const fmsItems = CORE.tally(index, (r) => Object.entries(r.fms)).map(([k, n]) => ({ key: k, label: fmsName(k), count: n }));
    const trItems = CORE.tally(index, (r) => (r.trainings ? Object.entries(r.trainings) : [])).map(([k, n]) => ({ key: k, label: k, count: n }));
    const dispItems = CORE.tally(index, (r) => [r.dispatch]).map(([k, n]) => ({ key: k, label: (byId.get(Number(k)) || {}).name || `#${k}`, count: n }));
    const scanned = index.filter((r) => r.trainings).length;
    const withStaff = index.filter((r) => r.personnel > 0).length;

    bodyEl.append(
      h('input', {
        type: 'search', class: 'mcmf-input', placeholder: 'Search building name or ID…', value: f.text,
        oninput: (e) => { f.text = e.target.value; applySoon(); },
      }),
      h('div', { class: 'mcmf-muted', style: 'margin:6px 0' }, 'Chips: click once to require, twice to exclude, three times to clear. Right-click excludes.'),
      section('types', 'Building types', () => ca(f.buildingTypes), chipGroup(typeItems, f.buildingTypes)),
      section('ext', 'Extensions', () => ca(f.extensions.chips),
        h('div', { class: 'mcmf-row' }, modeSel(f.extensions),
          select(f.extensions, 'state', [['built', 'Built'], ['enabled', 'Built & enabled'], ['construction', 'Under construction'], ['any', 'Built or building']], applySoon)),
        chipGroup(extItems, f.extensions.chips)),
      section('specs', 'Specializations', () => ca(f.specs.chips),
        specItems.length ? modeSel(f.specs) : null,
        chipGroup(specItems, f.specs.chips, {
          empty: 'The game API reports no specialization field for your buildings. Hospital specialties and similar are extensions, so use the Extensions section.',
        })),
      section('veh', 'Vehicles', () => ca(f.vehicles.chips),
        h('div', { class: 'mcmf-row' }, modeSel(f.vehicles), h('span', { class: 'mcmf-muted' }, 'at least'),
          numInput(f.vehicles, 'min', { min: 1, placeholder: '1' }), h('span', { class: 'mcmf-muted' }, 'of each')),
        chipGroup(vehItems, f.vehicles.chips)),
      section('fms', 'Vehicle status (right now)', () => ca(f.fms.chips),
        h('div', { class: 'mcmf-row' }, modeSel(f.fms), h('span', { class: 'mcmf-muted' }, 'has a vehicle in status…')),
        chipGroup(fmsItems, f.fms.chips)),
      section('train', 'Staff training', () => ca(f.trainings.chips),
        h('div', { class: 'mcmf-muted' }, `${scanned} of ${withStaff} staffed buildings scanned. `,
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); switchTab('staff'); } }, 'Scan staff…'),
          scanned < withStaff ? ' Unscanned buildings never match a training filter.' : ''),
        h('div', { class: 'mcmf-row' }, modeSel(f.trainings), h('span', { class: 'mcmf-muted' }, 'at least'),
          numInput(f.trainings, 'min', { min: 1, placeholder: '1' }), h('span', { class: 'mcmf-muted' }, 'trained staff each')),
        chipGroup(trItems, f.trainings.chips, { empty: 'No staff data yet. Scan staff on the Staff tab.' })),
      section('disp', 'Dispatch center', () => ca(f.dispatch), chipGroup(dispItems, f.dispatch, { empty: 'No buildings are assigned to a dispatch center.' })),
      section('nums', 'Numbers & flags', () => {
        let n = 0;
        for (const g of [f.personnel, f.level, f.vehicleCount]) if (g.min !== null || g.max !== null) n++;
        return n + Object.values(f.flags).filter((v) => v !== 'any').length + (f.area !== 'any' ? 1 : 0);
      },
      h('div', { class: 'mcmf-grid2' },
        range('Personnel', f.personnel),
        range('Level', f.level),
        range('Vehicles', f.vehicleCount),
        flagSel('Below personnel goal', 'understaffed'),
        flagSel('Hiring active', 'hiring'),
        flagSel('Shared with alliance', 'allianceShared'),
        flagSel('Small building', 'small'),
        h('span', null, 'In selected areas'),
        select(f, 'area', [['any', 'Any'], ['in', 'Inside'], ['out', 'Outside']], applySoon))),
    );
  }

  function switchTab(key) {
    cfg.ui.tab = key;
    panel.querySelectorAll('.mcmf-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === key));
    saveCfg();
    renderBody();
  }

  const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#14b8a6'];

  function renderCoverage() {
    const c = cfg.coverage;
    const redraw = debounce(() => { drawCoverage(); saveCfg(); }, 150);
    const typeItems = CORE.tally(index, (r) => [r.type]).map(([k, n]) => ({ key: k, label: typeName(k), count: n }));
    const vehItems = CORE.tally(index, (r) => Object.keys(r.vehicleTypes).map((k) => [k, 1])).map(([k, n]) => ({ key: k, label: vehicleName(k), count: n }));
    const ul = c.unit;

    const top = h('div', { class: 'mcmf-row' },
      h('label', { class: 'mcmf-row' },
        h('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => { c.enabled = e.target.checked; redraw(); } }),
        h('b', null, 'Show coverage')),
      h('span', { style: 'flex:1' }),
      h('span', { class: 'mcmf-muted' }, 'Units'),
      select(c, 'unit', [['km', 'km'], ['mi', 'miles']], () => {
        const f = c.unit === 'mi' ? 1 / 1.609344 : 1.609344;
        for (const l of c.layers) l.radius = Math.round(l.radius * f * 10) / 10;
        renderBody();
        redraw();
      }));

    const cards = c.layers.map((layer) => {
      const minutes = { m: null, speed: ul === 'mi' ? 45 : 70 };
      const radiusInput = numInput(layer, 'radius', { min: 0, step: 0.5, onChange: redraw });
      const srcBox = h('div');
      const renderSrc = () => {
        srcBox.replaceChildren(
          layer.source === 'types' ? chipGroup(typeItems, layer.types, { tri: false, onChange: redraw })
            : layer.source === 'vehicles' ? chipGroup(vehItems, layer.vehicles, { tri: false, onChange: redraw })
              : h('div', { class: 'mcmf-muted' }, 'Uses whatever the Filters tab currently matches.'));
      };
      renderSrc();
      return h('div', { class: 'mcmf-card' },
        h('div', { class: 'mcmf-row' },
          h('input', { type: 'checkbox', checked: layer.visible, title: 'Visible', onchange: (e) => { layer.visible = e.target.checked; redraw(); } }),
          h('input', { class: 'mcmf-input', style: 'flex:1;width:auto', value: layer.name, oninput: (e) => { layer.name = e.target.value; saveCfg(); } }),
          h('input', { type: 'color', value: layer.color, style: 'width:28px;height:22px;padding:0;border:0;background:none', oninput: (e) => { layer.color = e.target.value; redraw(); } }),
          h('button', {
            class: 'mcmf-btn', title: 'Delete layer',
            onclick: () => {
              c.layers = c.layers.filter((l) => l !== layer);
              if (c.analysisLayer === layer.id) c.analysisLayer = c.layers[0] ? c.layers[0].id : null;
              renderBody();
              redraw();
            },
          }, '🗑')),
        h('div', { class: 'mcmf-grid2' },
          h('span', null, 'Radius'), h('div', { class: 'mcmf-row' }, radiusInput, ul),
          h('span', { class: 'mcmf-muted' }, 'or from'),
          h('div', { class: 'mcmf-row mcmf-muted' },
            numInput(minutes, 'm', { placeholder: 'min', min: 0, onChange: () => {} }), 'min at',
            numInput(minutes, 'speed', { min: 1, onChange: () => {} }), `${ul === 'mi' ? 'mph' : 'km/h'}`,
            h('button', {
              class: 'mcmf-btn',
              onclick: () => {
                if (!minutes.m || !minutes.speed) return;
                layer.radius = Math.round((minutes.m / 60) * minutes.speed * 10) / 10;
                radiusInput.value = layer.radius;
                redraw();
              },
            }, 'Set')),
          h('span', null, 'Fill'),
          h('input', { type: 'range', min: 0.02, max: 0.5, step: 0.02, value: layer.opacity, oninput: (e) => { layer.opacity = Number(e.target.value); redraw(); } }),
          h('span', null, 'Stations'),
          select(layer, 'source', [['types', 'By building type'], ['vehicles', 'Having vehicle type'], ['filter', 'Current filter matches']], () => {
            renderSrc();
            redraw();
          })),
        srcBox);
    });

    const analysisOpts = c.layers.map((l) => [l.id, l.name || 'Layer']);
    bodyEl.append(
      top,
      h('div', { class: 'mcmf-muted', style: 'margin-top:6px' },
        'Circles are straight-line distance, a rough stand-in for response time. Overlaps show darker.'),
      ...cards,
      h('button', {
        class: 'mcmf-btn primary',
        onclick: () => {
          const id = `l${Date.now().toString(36)}`;
          c.layers.push({
            id, name: `Layer ${c.layers.length + 1}`, color: COLORS[c.layers.length % COLORS.length],
            radius: ul === 'mi' ? 5 : 8, opacity: 0.12, visible: true, source: 'types', types: {}, vehicles: {},
          });
          if (!c.analysisLayer) c.analysisLayer = id;
          c.enabled = true;
          renderBody();
          redraw();
        },
      }, '+ Add coverage layer'),
      c.layers.length ? h('div', { class: 'mcmf-card' },
        h('b', null, 'Gap analysis'),
        h('div', { class: 'mcmf-row' }, h('span', null, 'Layer'), select(c, 'analysisLayer', analysisOpts, redraw)),
        h('label', { class: 'mcmf-row' },
          h('input', { type: 'checkbox', checked: c.shadeGaps, onchange: (e) => { c.shadeGaps = e.target.checked; redraw(); } }),
          'Shade uncovered areas in view'),
        h('label', { class: 'mcmf-row' },
          h('input', { type: 'checkbox', checked: c.markMissions, onchange: (e) => { c.markMissions = e.target.checked; redraw(); } }),
          'Ring missions outside coverage'),
        h('label', { class: 'mcmf-row' },
          h('input', { type: 'checkbox', checked: c.clipToAreas, onchange: (e) => { c.clipToAreas = e.target.checked; redraw(); } }),
          'Shade whole selected areas, not just the view'),
        h('div', { class: 'mcmf-row mcmf-muted' }, 'Grid detail', numInput(c, 'gridSize', { min: 10, onChange: redraw }), 'cells per side'),
        h('div', { id: 'mcmf-covstats', class: 'mcmf-muted' })) : null,
    );
    updateCoverageStats();
  }

  function usCountiesCard() {
    const a = cfg.areas;
    const us = h('div', { class: 'mcmf-card' }, h('b', null, 'US counties'));
    if (!atlas) {
      const msg = h('div', { class: 'mcmf-muted' }, 'Loading county boundaries…');
      us.append(msg);
      loadAtlas().then(() => {
        if (!a.state) a.state = detectState();
        drawAreas();
        saveCfg();
        if (cfg.ui.tab === 'areas') renderBody();
      }).catch((e) => {
        msg.textContent = `Could not load county boundaries: ${e.message}`;
        msg.classList.add('mcmf-err');
      });
    } else {
      const counties = atlas.counties.filter((c) => c.stateId === a.state);
      const refresh = () => {
        areasChanged();
        renderBody();
      };
      us.append(
        h('div', { class: 'mcmf-row' },
          select(a, 'state', [['', 'Choose a state…'], ...atlas.states.map((s) => [s.id, s.name])], () => {
            drawAreas();
            saveCfg();
            renderBody();
          }),
          h('button', {
            class: 'mcmf-btn', title: 'Pick the state in the middle of the map',
            onclick: () => {
              a.state = detectState();
              drawAreas();
              saveCfg();
              renderBody();
            },
          }, 'Use map center'),
          a.state ? h('button', { class: 'mcmf-btn', onclick: () => zoomToArea(areaGeo.get(`us-state:${a.state}`)) }, 'Zoom') : null),
        h('label', { class: 'mcmf-row' },
          h('input', {
            type: 'checkbox', checked: a.pick,
            onchange: (e) => {
              a.pick = e.target.checked;
              if (a.pick) a.visible = true;
              drawAreas();
              saveCfg();
            },
          }),
          'Click counties on the map to select them'),
        a.state ? h('div', { class: 'mcmf-row' },
          h('span', { class: 'mcmf-muted', style: 'flex:1' }, `${counties.length} counties · ${counties.filter((c) => a.selected[c.id]).length} selected`),
          h('button', { class: 'mcmf-btn', onclick: () => { for (const c of counties) a.selected[c.id] = 1; refresh(); } }, 'All'),
          h('button', { class: 'mcmf-btn', onclick: () => { for (const c of counties) delete a.selected[c.id]; refresh(); } }, 'None')) : null,
        a.state ? chipGroup(counties.map((c) => ({ key: c.id, label: c.name })), a.selected, { tri: false, onChange: refresh }) : null,
      );
    }
    return us;
  }

  function ukCountiesCard() {
    const a = cfg.areas;
    const items = ukList(a.ukRegion);
    const loaded = items.filter((c) => areaGeo.has(c.id)).length;
    const missing = items.length - loaded;
    const selectAndLoad = (ids) => {
      for (const id of ids) a.selected[id] = 1;
      areasChanged();
      loadUkItems(items.filter((c) => ids.includes(c.id)));
      renderBody();
    };
    return h('div', { class: 'mcmf-card' },
      h('b', null, 'UK counties'),
      select(a, 'ukRegion', Object.entries(UK_REGIONS).map(([k, r]) => [k, r.title]), () => {
        drawAreas();
        saveCfg();
        renderBody();
      }),
      h('label', { class: 'mcmf-row' },
        h('input', {
          type: 'checkbox', checked: a.pick,
          onchange: (e) => {
            a.pick = e.target.checked;
            if (a.pick) a.visible = true;
            drawAreas();
            saveCfg();
            renderBody();
          },
        }),
        'Click counties on the map to select them'),
      a.pick && missing ? h('div', { class: 'mcmf-muted' },
        `${missing} of ${items.length} boundaries aren’t downloaded yet, so they can’t be clicked. `,
        ukLoad.running ? null : h('a', { href: '#', onclick: (e) => { e.preventDefault(); loadUkItems(items); } },
          `Download them (about ${Math.ceil(missing * 1.2)} s, once)`)) : null,
      ukLoad.running ? h('div', { id: 'mcmf-ukload', class: 'mcmf-muted' }, `Loading boundaries… ${ukLoad.done} / ${ukLoad.total}`) : null,
      ukLoad.failed.length ? h('div', { class: 'mcmf-muted mcmf-err' },
        `Couldn’t find a boundary for ${ukLoad.failed.join(', ')}. Try the search box below.`) : null,
      h('div', { class: 'mcmf-row' },
        h('span', { class: 'mcmf-muted', style: 'flex:1' }, `${items.length} areas · ${items.filter((c) => a.selected[c.id]).length} selected`),
        h('button', { class: 'mcmf-btn', onclick: () => selectAndLoad(items.map((c) => c.id)) }, 'All'),
        h('button', {
          class: 'mcmf-btn',
          onclick: () => {
            for (const c of items) delete a.selected[c.id];
            areasChanged();
            renderBody();
          },
        }, 'None')),
      chipGroup(items.map((c) => ({ key: c.id, label: c.label })), a.selected, {
        tri: false,
        onChange: () => {
          const toLoad = items.filter((c) => a.selected[c.id] && !areaGeo.has(c.id));
          areasChanged();
          if (toLoad.length) loadUkItems(toLoad);
          renderBody();
        },
      }),
      h('div', { class: 'mcmf-muted' }, 'Boundaries come from OpenStreetMap and are saved in your browser after the first download.'));
  }

  function renderAreas() {
    const a = cfg.areas;
    const [unitLabel, unitMul] = areaUnit();
    const fmt = (n) => Math.round(n).toLocaleString();

    bodyEl.append(h('div', { class: 'mcmf-muted' },
      'Select counties or other areas to outline them on the map, see what’s inside them, filter buildings to them (Filters → Numbers & flags) and measure coverage inside them.'));

    if (IS_US) bodyEl.append(usCountiesCard());
    if (IS_UK) bodyEl.append(ukCountiesCard());

    // Any area via OpenStreetMap
    const q = { v: '' };
    const results = h('div', { class: 'mcmf-sec' });
    const status = h('div', { class: 'mcmf-muted' });
    const showResults = () => {
      results.replaceChildren(...osmResults.map((r) => h('div', { class: 'mcmf-row' },
        h('span', { style: 'flex:1', title: r.full }, r.name, ' ', h('span', { class: 'mcmf-muted' }, r.kind)),
        a.selected[r.id] ? h('span', { class: 'mcmf-muted' }, 'added')
          : h('button', {
            class: 'mcmf-btn',
            onclick: () => {
              areaGeo.set(r.id, CORE.makeArea(r.id, r.name, r.polys));
              a.selected[r.id] = 1;
              areasChanged();
              zoomToArea(areaGeo.get(r.id));
              renderBody();
            },
          }, 'Add'))));
    };
    const doSearch = async () => {
      if (!q.v) return;
      status.textContent = 'Searching…';
      try {
        osmResults = await searchOsm(q.v);
        status.textContent = osmResults.length ? '' : 'No areas with a boundary found. Try adding the state or country.';
      } catch (e) {
        status.textContent = `Search failed: ${e.message}`;
      }
      showResults();
    };
    showResults();
    bodyEl.append(h('div', { class: 'mcmf-card' },
      h('b', null, IS_US || IS_UK ? 'Any other area' : 'Find an area'),
      h('div', { class: 'mcmf-muted' }, 'Cities, townships, counties, districts… anywhere, from OpenStreetMap.'),
      h('div', { class: 'mcmf-row' },
        h('input', {
          type: 'search', class: 'mcmf-input', style: 'flex:1;width:auto', placeholder: IS_US ? 'e.g. Pittsburgh, PA' : IS_UK ? 'e.g. Canterbury, Kent' : 'e.g. Kent, England',
          oninput: (e) => { q.v = e.target.value.trim(); },
          onkeydown: (e) => { if (e.key === 'Enter') doSearch(); },
        }),
        h('button', { class: 'mcmf-btn', onclick: doSearch }, 'Search')),
      status, results));

    // Selected areas
    const sel = Object.keys(a.selected);
    const list = h('div', { class: 'mcmf-card' },
      h('div', { class: 'mcmf-row' },
        h('b', { style: 'flex:1' }, `Selected areas (${sel.length})`),
        h('label', { class: 'mcmf-row', title: 'Also on the map button under the filter button' },
          h('input', { type: 'checkbox', checked: a.visible, onchange: (e) => setAreasVisible(e.target.checked) }), 'Show on map'),
        h('input', { type: 'color', value: a.color, title: 'Outline color', style: 'width:28px;height:22px;padding:0;border:0;background:none', oninput: (e) => { a.color = e.target.value; drawAreas(); saveCfg(); } }),
        sel.length ? h('button', {
          class: 'mcmf-btn',
          onclick: () => {
            if (!confirm('Remove all selected areas?')) return;
            a.selected = {};
            areasChanged();
            renderBody();
          },
        }, 'Clear') : null),
      h('div', { class: 'mcmf-row mcmf-muted' },
        'Fill', h('input', { type: 'range', min: 0, max: 0.5, step: 0.02, value: a.opacity, oninput: (e) => { a.opacity = Number(e.target.value); drawAreas(); saveCfg(); } }),
        h('label', { class: 'mcmf-row' },
          h('input', { type: 'checkbox', checked: a.labels, onchange: (e) => { a.labels = e.target.checked; drawAreas(); saveCfg(); } }), 'Labels')));
    if (!sel.length) list.append(h('div', { class: 'mcmf-muted' }, 'Nothing selected yet.'));
    let totals = { size: 0, missions: 0 };
    const uniqueBuildings = new Set();
    for (const id of sel) {
      const geo = areaGeo.get(id);
      const remove = h('button', {
        class: 'mcmf-btn', title: 'Remove',
        onclick: () => {
          delete a.selected[id];
          areasChanged();
          renderBody();
        },
      }, '✕');
      if (!geo) {
        list.append(h('div', { class: 'mcmf-row' }, h('span', { style: 'flex:1' }, areaLabel(id), h('span', { class: 'mcmf-muted' }, ' · loading…')), remove));
        continue;
      }
      const st = areaStats(geo);
      totals = { size: totals.size + st.size, missions: totals.missions + st.missions };
      for (const r of st.inside) uniqueBuildings.add(r.id);
      list.append(h('div', { style: 'border-top:1px solid var(--line);padding-top:6px' },
        h('div', { class: 'mcmf-row' },
          h('b', { style: 'flex:1' }, geo.name),
          h('button', { class: 'mcmf-btn', onclick: () => zoomToArea(geo) }, 'Zoom'),
          remove),
        h('div', { class: 'mcmf-stat' },
          h('b', null, fmt(st.size * unitMul)), ` ${unitLabel} · `,
          h('b', null, st.inside.length), ' buildings · ',
          h('b', null, st.missions), ' missions now',
          st.coverage !== null ? [' · ', h('b', null, `${Math.round(st.coverage * 100)}%`), ` covered by “${st.layer.name}”`] : null),
        st.types.length ? h('div', { class: 'mcmf-stat' }, st.types.map(([t, n]) => `${n}× ${typeName(t)}`).join(', ')) : null));
    }
    if (sel.length > 1) {
      list.append(h('div', { class: 'mcmf-stat', style: 'border-top:1px solid var(--line);padding-top:6px' },
        'Total: ', h('b', null, fmt(totals.size * unitMul)), ` ${unitLabel} · `, h('b', null, uniqueBuildings.size), ' buildings · ',
        h('b', null, totals.missions), ' missions now'));
    }
    if (sel.length && !cfg.coverage.layers.length) {
      list.append(h('div', { class: 'mcmf-muted' }, 'Add a coverage layer on the Coverage tab to see how much of each area your stations cover.'));
    }
    bodyEl.append(list);
  }

  function updateCoverageStats() {
    const el = document.getElementById('mcmf-covstats');
    if (el) el.textContent = lastStats || 'Enable an option above to see stats for the current view.';
  }

  function renderStaff() {
    const s = cfg.staffScan;
    const withStaff = index.filter((r) => r.personnel > 0);
    const scanned = withStaff.filter((r) => staff[r.id]);
    const oldest = scanned.reduce((m, r) => Math.min(m, staff[r.id].ts), Infinity);
    bodyEl.append(
      h('div', { class: 'mcmf-muted' },
        'The game API has no staff-training endpoint, so this opens each building’s personnel page in the background (one at a time) and reads the training column. Results are cached in your browser.'),
      h('div', { class: 'mcmf-card' },
        h('div', null, h('b', null, `${scanned.length} / ${withStaff.length}`), ' staffed buildings scanned',
          Number.isFinite(oldest) ? h('span', { class: 'mcmf-muted' }, ` · oldest ${new Date(oldest).toLocaleString()}`) : null),
        h('div', { class: 'mcmf-grid2' },
          h('span', null, 'Delay between pages'), h('div', { class: 'mcmf-row' }, numInput(s, 'delay', { min: 100, step: 50, onChange: saveCfg }), 'ms'),
          h('span', null, 'Rescan if older than'), h('div', { class: 'mcmf-row' }, numInput(s, 'maxAgeHours', { min: 0, onChange: saveCfg }), 'hours')),
        h('label', { class: 'mcmf-row' },
          h('input', { type: 'checkbox', checked: s.onlyMatched, onchange: (e) => { s.onlyMatched = e.target.checked; saveCfg(); } }),
          'Only buildings matching the current filters'),
        h('div', { class: 'mcmf-row' },
          h('button', { class: 'mcmf-btn primary', disabled: scan.running, onclick: runScan }, scan.running ? 'Scanning…' : 'Scan staff'),
          h('button', { class: 'mcmf-btn', disabled: !scan.running, onclick: () => { scan.abort = true; } }, 'Stop'),
          h('span', { style: 'flex:1' }),
          h('button', {
            class: 'mcmf-btn',
            disabled: scan.running,
            onclick: () => {
              if (!confirm('Forget all scanned staff data?')) return;
              staff = {};
              store.del('staff');
              rebuild();
            },
          }, 'Clear cache')),
        h('div', { class: 'mcmf-bar' }, h('div', { id: 'mcmf-scanbar' })),
        h('div', { id: 'mcmf-scantext', class: 'mcmf-muted' })),
    );
    updateScanProgress();
  }

  function updateScanProgress() {
    const bar = document.getElementById('mcmf-scanbar');
    const txt = document.getElementById('mcmf-scantext');
    if (!bar || !txt) return;
    if (!scan.total && !scan.running) {
      txt.textContent = '';
      return;
    }
    bar.style.width = `${scan.total ? (scan.done / scan.total) * 100 : 100}%`;
    txt.textContent = `${scan.done} / ${scan.total} pages${scan.errors ? ` · ${scan.errors} failed` : ''}${scan.running ? '' : ' · done'}`;
  }

  function renderPresets() {
    const name = { v: '' };
    const list = Object.keys(cfg.presets).sort();
    const fileIn = h('input', {
      type: 'file', accept: 'application/json', style: 'display:none',
      onchange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const obj = JSON.parse(await file.text());
          if (!obj || typeof obj !== 'object') throw new Error('not an object');
          const fresh = CORE.mergeDeep(defaultConfig(), obj);
          for (const k of Object.keys(cfg)) delete cfg[k];
          Object.assign(cfg, fresh);
          saveCfg();
          renderSummary();
          apply();
          renderBody();
          setStatus('Settings imported.');
        } catch (err) {
          setStatus(`Import failed: ${err.message}`, true);
        }
      },
    });
    bodyEl.append(
      h('div', { class: 'mcmf-row' },
        h('input', { class: 'mcmf-input', style: 'flex:1;width:auto', placeholder: 'Preset name, e.g. “ALS ambulances”', oninput: (e) => { name.v = e.target.value.trim(); } }),
        h('button', {
          class: 'mcmf-btn primary',
          onclick: () => {
            if (!name.v) return;
            cfg.presets[name.v] = JSON.parse(JSON.stringify(cfg.filters));
            saveCfg();
            renderBody();
          },
        }, 'Save current filters')),
      ...(list.length ? list.map((n) => h('div', { class: 'mcmf-card mcmf-row' },
        h('b', { style: 'flex:1' }, n),
        h('button', {
          class: 'mcmf-btn',
          onclick: () => {
            cfg.filters = CORE.mergeDeep(CORE.defaultFilters(), JSON.parse(JSON.stringify(cfg.presets[n])));
            apply();
            switchTab('filters');
          },
        }, 'Apply'),
        h('button', {
          class: 'mcmf-btn',
          onclick: () => {
            delete cfg.presets[n];
            saveCfg();
            renderBody();
          },
        }, 'Delete')))
        : [h('div', { class: 'mcmf-muted', style: 'margin:8px 0' }, 'No presets yet. Set up filters, name them above and save.')]),
      h('div', { class: 'mcmf-card' },
        h('b', null, 'Backup'),
        h('div', { class: 'mcmf-muted' }, 'Export or import all settings: filters, presets and coverage layers.'),
        h('div', { class: 'mcmf-row' },
          h('button', { class: 'mcmf-btn', onclick: () => download(`mcmf-settings-${HOST}.json`, JSON.stringify(cfg, null, 2), 'application/json') }, 'Export'),
          h('button', { class: 'mcmf-btn', onclick: () => fileIn.click() }, 'Import'),
          fileIn)),
    );
  }

  function zoomToMatches() {
    const pts = matched.filter((r) => Number.isFinite(r.lat)).map((r) => [r.lat, r.lng]);
    if (!pts.length) return;
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
  }

  function exportCsv() {
    const rows = [['id', 'name', 'type', 'latitude', 'longitude', 'level', 'personnel', 'personnel_goal', 'vehicles', 'vehicle_types', 'extensions', 'trainings']];
    for (const r of matched) {
      rows.push([
        r.id, r.name, typeName(r.type), r.lat, r.lng, r.level, r.personnel, r.personnelGoal ?? '', r.vehicleCount,
        Object.entries(r.vehicleTypes).map(([k, n]) => `${n}x ${vehicleName(k)}`).join('; '),
        r.ext.filter((e) => e.available).map((e) => e.caption).join('; '),
        r.trainings ? Object.entries(r.trainings).map(([k, n]) => `${n}x ${k}`).join('; ') : '',
      ]);
    }
    download(`buildings-${HOST}-${new Date().toISOString().slice(0, 10)}.csv`, CORE.toCsv(rows), 'text/csv');
  }

  function resetFilters() {
    cfg.filters = CORE.defaultFilters();
    apply();
    renderBody();
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    try {
      await waitFor(() => window.L && window.map && typeof window.map.getBounds === 'function');
    } catch (e) {
      return; // no map on this page
    }
    L = window.L;
    map = window.map;
    renderer = L.canvas({ padding: 0.5 });
    layers.cov = L.layerGroup().addTo(map);
    layers.gap = L.layerGroup().addTo(map);
    layers.miss = L.layerGroup().addTo(map);
    layers.hl = L.layerGroup().addTo(map);
    const pane = map.createPane('mcmfAreas');
    pane.style.pointerEvents = 'none';
    areaRenderer = L.svg({ pane: 'mcmfAreas', padding: 0.5 });
    layers.areas = L.layerGroup().addTo(map);
    for (const [id, a] of Object.entries(store.get('areaGeo', {}))) areaGeo.set(id, CORE.makeArea(id, a.name, a.polys));
    drawAreas();
    if (IS_UK) {
      areaDb.all().then((rows) => {
        for (const row of rows) if (!areaGeo.has(row.id)) areaGeo.set(row.id, CORE.makeArea(row.id, row.name, row.polys));
        drawAreas();
        apply();
        if (cfg.ui.tab === 'areas') renderBody();
        // Re-fetch any selected county whose cached boundary was cleared by the browser.
        const all = Object.keys(UK_REGIONS).flatMap(ukList);
        loadUkItems(all.filter((c) => cfg.areas.selected[c.id] && !areaGeo.has(c.id)));
      });
    }
    if (Object.keys(cfg.areas.selected).some((id) => id.startsWith('us:'))) {
      loadAtlas().then(() => {
        drawAreas();
        apply();
        if (cfg.ui.tab === 'areas') renderBody();
      }).catch((e) => console.warn('[MCMF] could not load county boundaries', e));
    }

    const Ctl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const d = L.DomUtil.create('div', 'leaflet-bar mcmf-ctl');
        const a = L.DomUtil.create('a', '', d);
        a.href = '#';
        a.title = 'Map filter & coverage';
        a.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>';
        L.DomEvent.on(a, 'click', (e) => {
          L.DomEvent.preventDefault(e);
          togglePanel();
        });
        areasBtn = L.DomUtil.create('a', '', d);
        areasBtn.href = '#';
        areasBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 6l5-2 6 3 5-2v13l-5 2-6-3-5 2z"/><path d="M9 4v13M15 7v13"/></svg>';
        L.DomEvent.on(areasBtn, 'click', (e) => {
          L.DomEvent.preventDefault(e);
          setAreasVisible(!cfg.areas.visible);
        });
        updateAreasButton();
        L.DomEvent.disableClickPropagation(d);
        return d;
      },
    });
    map.addControl(new Ctl());

    buildPanel();
    const reapply = debounce(applyMarkers, 150);
    map.on('layeradd', reapply);
    map.on('zoomend moveend', () => {
      reapply();
      if (cfg.coverage.enabled && (cfg.coverage.shadeGaps || cfg.coverage.markMissions)) drawAnalysis();
    });
    setInterval(() => {
      if (cfg.coverage.enabled && cfg.coverage.markMissions) drawAnalysis();
    }, 30000);

    loadMeta().then(() => { if (index.length) renderBody(); });
    await refreshData();
  }

  boot();
})();
