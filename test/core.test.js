'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CORE = require('../missionchief-map-filter.user.js');

const buildings = [
  {
    id: 1, caption: 'Station 1', building_type: 0, latitude: 40, longitude: -75, personal_count: 20, personal_count_goal: 25, level: 5,
    leitstelle_building_id: 9, extensions: [
      { caption: 'Ambulance Extension', available: true, enabled: true, type_id: 0 },
      { caption: 'Water Rescue', available: false, enabled: true, type_id: 1 },
    ],
  },
  {
    id: 2, caption: 'Station 2', building_type: 0, latitude: 40.1, longitude: -75, personal_count: 10, personal_count_goal: 10, level: 1,
    is_alliance_shared: true, extensions: [{ caption: 'Ambulance Extension', available: true, enabled: false, type_id: 0 }],
  },
  { id: 3, caption: 'Hospital', building_type: 4, latitude: 41, longitude: -75, personal_count: 0, extensions: [], specialization: 'Trauma' },
];
const vehicles = [
  { id: 10, building_id: 1, vehicle_type: 0, fms_real: 2 },
  { id: 11, building_id: 1, vehicle_type: 0, fms_real: 3 },
  { id: 12, building_id: 1, vehicle_type: 5, fms_real: 2 },
  { id: 13, building_id: 2, vehicle_type: 5, fms_real: 6 },
];
const staff = { 1: { ts: 0, trainings: { HazMat: 3 } }, 2: { ts: 0, trainings: {} } };

const index = CORE.buildIndex(buildings, vehicles, staff);
const run = (patch) => {
  const f = CORE.mergeDeep(CORE.defaultFilters(), patch);
  return index.filter((r) => CORE.matches(r, f)).map((r) => r.id);
};

test('buildIndex aggregates vehicles, status and flags', () => {
  const s1 = index.find((r) => r.id === 1);
  assert.deepEqual(s1.vehicleTypes, { 0: 2, 5: 1 });
  assert.deepEqual(s1.fms, { 2: 2, 3: 1 });
  assert.equal(s1.understaffed, true);
  assert.equal(index.find((r) => r.id === 3).trainings, null);
  assert.deepEqual(index.find((r) => r.id === 3).specs, ['Trauma']);
});

test('no filters is inactive and matches everything', () => {
  assert.equal(CORE.filtersActive(CORE.defaultFilters()), false);
  assert.deepEqual(run({}), [1, 2, 3]);
});

test('building type include / exclude', () => {
  assert.deepEqual(run({ buildingTypes: { 0: 1 } }), [1, 2]);
  assert.deepEqual(run({ buildingTypes: { 0: -1 } }), [3]);
});

test('extension state', () => {
  assert.deepEqual(run({ extensions: { chips: { 'Ambulance Extension': 1 }, state: 'built' } }), [1, 2]);
  assert.deepEqual(run({ extensions: { chips: { 'Ambulance Extension': 1 }, state: 'enabled' } }), [1]);
  assert.deepEqual(run({ extensions: { chips: { 'Water Rescue': 1 }, state: 'construction' } }), [1]);
  assert.deepEqual(run({ extensions: { chips: { 'Water Rescue': 1 }, state: 'built' } }), []);
  assert.deepEqual(run({ extensions: { chips: { 'Ambulance Extension': -1 } } }), [3]);
});

test('vehicles: any / all / min count / exclude', () => {
  assert.deepEqual(run({ vehicles: { chips: { 0: 1, 5: 1 }, mode: 'any' } }), [1, 2]);
  assert.deepEqual(run({ vehicles: { chips: { 0: 1, 5: 1 }, mode: 'all' } }), [1]);
  assert.deepEqual(run({ vehicles: { chips: { 0: 1 }, min: 3 } }), []);
  assert.deepEqual(run({ vehicles: { chips: { 0: 1 }, min: 2 } }), [1]);
  assert.deepEqual(run({ vehicles: { chips: { 5: -1 } } }), [3]);
});

test('vehicle status', () => {
  assert.deepEqual(run({ fms: { chips: { 6: 1 } } }), [2]);
});

test('trainings require a scan', () => {
  assert.deepEqual(run({ trainings: { chips: { HazMat: 1 } } }), [1]);
  assert.deepEqual(run({ trainings: { chips: { HazMat: 1 }, min: 4 } }), []);
  assert.deepEqual(run({ trainings: { chips: { HazMat: -1 } } }), [2]); // 3 is unscanned
});

test('ranges, flags, dispatch, text, specs', () => {
  assert.deepEqual(run({ personnel: { min: 5, max: 15 } }), [2]);
  assert.deepEqual(run({ level: { min: 2 } }), [1]);
  assert.deepEqual(run({ flags: { allianceShared: 'yes' } }), [2]);
  assert.deepEqual(run({ flags: { understaffed: 'yes' } }), [1]);
  assert.deepEqual(run({ dispatch: { 9: 1 } }), [1]);
  assert.deepEqual(run({ text: 'station 2' }), [2]);
  assert.deepEqual(run({ text: '3' }), [3]);
  assert.deepEqual(run({ specs: { chips: { Trauma: 1 } } }), [3]);
});

test('distance and coverage grid', () => {
  const d = CORE.distKm(40, -75, 40.1, -75);
  assert.ok(Math.abs(d - 11.12) < 0.05, `got ${d}`);
  const centers = [{ lat: 0, lng: 0, r: 50 }];
  assert.equal(CORE.isCovered(0.2, 0.2, centers), true);
  assert.equal(CORE.isCovered(1, 1, centers), false);
  const full = CORE.gridCoverage({ south: -0.1, west: -0.1, north: 0.1, east: 0.1 }, centers, 10);
  assert.equal(full.fraction, 1);
  assert.equal(full.uncovered.length, 0);
  const none = CORE.gridCoverage({ south: 5, west: 5, north: 6, east: 6 }, centers, 10);
  assert.equal(none.fraction, 0);
  assert.equal(none.uncovered.length, 100);
  assert.equal(CORE.centersNear({ south: 5, west: 5, north: 6, east: 6 }, centers).length, 0);
});

test('csv escaping', () => {
  assert.equal(CORE.toCsv([['a', 'b,c', 'say "hi"']]), 'a,"b,c","say ""hi"""');
});

test('area filter uses rec.inArea', () => {
  const recs = CORE.buildIndex(buildings, vehicles, staff);
  recs[0].inArea = true;
  const f = CORE.mergeDeep(CORE.defaultFilters(), { area: 'in' });
  assert.equal(CORE.filtersActive(f), true);
  assert.deepEqual(recs.filter((r) => CORE.matches(r, f)).map((r) => r.id), [1]);
  f.area = 'out';
  assert.deepEqual(recs.filter((r) => CORE.matches(r, f)).map((r) => r.id), [2, 3]);
});

// A 1°×1° square with a 0.5°×0.5° hole in the middle.
const square = CORE.makeArea('t', 'Test', [[
  [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
  [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]],
]]);

test('point in area respects holes and bbox', () => {
  assert.deepEqual(square.bbox, { west: 0, south: 0, east: 1, north: 1 });
  assert.equal(CORE.inArea(0.1, 0.1, square), true);
  assert.equal(CORE.inArea(0.5, 0.5, square), false); // in the hole
  assert.equal(CORE.inArea(1.5, 0.5, square), false);
});

test('area size and coverage inside an area', () => {
  // 1°×1° at the equator ≈ 111.32 × 110.574 km, minus a quarter for the hole.
  const expected = 111.32 * 110.574 * 0.75;
  assert.ok(Math.abs(CORE.areaKm2(square) - expected) / expected < 0.01, `got ${CORE.areaKm2(square)}`);
  const none = CORE.areaCoverage(square, [], 20);
  assert.equal(none.fraction, 0);
  assert.equal(none.uncovered.length, none.inside);
  const all = CORE.areaCoverage(square, [{ lat: 0.5, lng: 0.5, r: 200 }], 20);
  assert.equal(all.fraction, 1);
  assert.equal(all.inside, 300); // 400 cells minus the 100 in the hole
});

test('TopoJSON decoding (quantized, delta-encoded, reversed arcs)', () => {
  const topo = {
    transform: { scale: [1, 1], translate: [10, 20] },
    arcs: [[[0, 0], [2, 0], [0, 2]], [[2, 2], [-2, 0], [0, -2]]],
    objects: {
      things: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[0, 1]], id: '42', properties: { name: 'Box' } }] },
    },
  };
  const [f] = CORE.topoFeatures(topo, 'things');
  assert.equal(f.id, '42');
  assert.equal(f.name, 'Box');
  assert.deepEqual(f.polys, [[[[10, 20], [12, 20], [12, 22], [10, 22], [10, 20]]]]);
  const rev = { ...topo, objects: { t: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[~1, ~0]] }] } } };
  assert.deepEqual(CORE.topoFeatures(rev, 't')[0].polys[0][0], [[10, 20], [10, 22], [12, 22], [12, 20], [10, 20]]);
});

test('GeoJSON to polys', () => {
  const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
  assert.deepEqual(CORE.geojsonToPolys({ type: 'Polygon', coordinates: [ring] }), [[ring]]);
  assert.deepEqual(CORE.geojsonToPolys({ type: 'MultiPolygon', coordinates: [[ring], [ring]] }).length, 2);
  assert.deepEqual(CORE.geojsonToPolys({ type: 'Point', coordinates: [0, 0] }), []);
});

test('sites: parse Overpass elements into categories with addresses', () => {
  const els = [
    { type: 'node', id: 1, lat: 50.4, lon: -4.1, tags: { amenity: 'fire_station', name: 'Plymouth Camels Head', 'addr:housenumber': '1', 'addr:street': 'Ferry Road', 'addr:city': 'Plymouth', 'addr:postcode': 'PL2 1AA' } },
    { type: 'way', id: 2, center: { lat: 50.5, lon: -4.2 }, tags: { emergency: 'ambulance_station' } },
    { type: 'way', id: 3, center: { lat: 50.6, lon: -4.3 }, tags: { amenity: 'hospital', emergency: 'yes', name: 'Derriford' } },
    { type: 'node', id: 4, lat: 50.7, lon: -4.4, tags: { shop: 'bakery' } },
    { type: 'node', id: 5, lat: 50.8, lon: -4.5, tags: { emergency: 'lifeboat_station', name: 'Padstow Lifeboat Station' } },
    { type: 'node', id: 6, lat: 50.9, lon: -4.6, tags: { aeroway: 'helipad', name: 'Cornwall Air Ambulance' } },
  ];
  const all = CORE.SITE_CATS.map((c) => c.key);
  const sites = CORE.parseSites(els, all);
  assert.deepEqual(sites.map((s) => s.cat), ['fire', 'ambulance', 'hospital', 'lifeboat', 'air']);
  assert.equal(sites[0].address, '1 Ferry Road, Plymouth, PL2 1AA');
  assert.equal(sites[1].name, 'Ambulance station (unnamed)');
  assert.equal(sites[1].lat, 50.5);
  assert.equal(sites[2].aande, true);
  assert.deepEqual(CORE.parseSites(els, ['police']), []);
});

test('sites: address formatting', () => {
  assert.equal(CORE.formatAddress({ 'addr:street': 'High Street' }), 'High Street');
  assert.equal(CORE.formatAddress({ 'addr:city': 'Truro' }), ''); // a town alone isn't a usable address
  assert.equal(CORE.formatAddress({ 'addr:postcode': 'TR1 1AA' }), 'TR1 1AA');
  assert.equal(CORE.formatReverse({ house_number: '5', road: 'Station Rd', village: 'Bude', postcode: 'EX23 8AA' }), '5 Station Rd, Bude, EX23 8AA');
  assert.equal(CORE.formatReverse({ road: 'A30', town: 'Bodmin', postcode: 'PL31' }), 'A30, Bodmin, PL31');
});

test('sites: duplicates of one station collapse to the better entry', () => {
  const s = [
    { cat: 'fire', lat: 50, lng: -4, named: false, address: '' },
    { cat: 'fire', lat: 50.0003, lng: -4, named: true, address: 'x' }, // ~33 m away
    { cat: 'police', lat: 50, lng: -4, named: true, address: '' }, // other category stays
    { cat: 'fire', lat: 50.01, lng: -4, named: true, address: '' }, // ~1.1 km away stays
  ];
  const d = CORE.dedupeSites(s);
  assert.equal(d.length, 3);
  assert.ok(d.includes(s[1]) && !d.includes(s[0]));
});

test('sites: already built detection by matching building type', () => {
  const recs = [
    { name: 'My Fire Station', type: 0, lat: 50, lng: -4 },
    { name: 'My Fire Academy', type: 9, lat: 51, lng: -4 },
  ];
  const names = { 0: 'Fire Station', 9: 'Fire Academy' };
  const sites = [
    { cat: 'fire', lat: 50.002, lng: -4 }, // ~220 m from my station
    { cat: 'fire', lat: 51, lng: -4 }, // on top of the academy, which doesn't count
    { cat: 'police', lat: 50, lng: -4 }, // I own no police station, so a fire station here doesn't count
  ];
  CORE.markBuilt(sites, recs, (t) => names[t], 500);
  assert.deepEqual(sites.map((s) => s.built), ['My Fire Station', null, null]);
  // Type names unavailable: fall back to any building nearby.
  CORE.markBuilt(sites, recs, () => '', 500);
  assert.deepEqual(sites.map((s) => s.built), ['My Fire Station', 'My Fire Academy', 'My Fire Station']);
});

test('sites: overpass query includes only requested categories', () => {
  const q = CORE.overpassQuery({ south: 49.9, west: -6.4, north: 52.1, east: -1.5 }, ['fire', 'coastguard']);
  assert.match(q, /"amenity"="fire_station"\]\(49\.9,-6\.4,52\.1,-1\.5\)/);
  assert.match(q, /coast_guard/);
  assert.doesNotMatch(q, /hospital/);
  assert.match(q, /out center tags;$/);
});

test('alliance: categories from game type names and building names', () => {
  assert.equal(CORE.catFromTypeName('Fire Station (Small)'), 'fire');
  assert.equal(CORE.catFromTypeName('Fire Academy'), null);
  assert.equal(CORE.catFromTypeName('Air Ambulance Station'), 'air');
  assert.equal(CORE.catFromTypeName('Police Aviation'), 'air');
  assert.equal(CORE.catFromTypeName('Coastal Rescue Station'), 'coastguard');
  assert.equal(CORE.catFromName('Truro Fire Station'), 'fire');
  assert.equal(CORE.catFromName('Cornwall Air Ambulance'), 'air');
  assert.equal(CORE.catFromName('Falmouth RNLI'), 'lifeboat');
  assert.equal(CORE.catFromName('Royal Cornwall Hospital'), 'hospital');
  assert.equal(CORE.catFromName('Bob\'s base'), null);
});

test('alliance: name similarity ignores generic words', () => {
  assert.deepEqual([...CORE.nameTokens('Exeter Middlemoor Fire Station 01')], ['exeter', 'middlemoor']);
  assert.equal(CORE.namesSimilar('Exeter Fire Station', 'Exeter Middlemoor FS'), true);
  assert.equal(CORE.namesSimilar('Exeter Fire Station', 'Plymouth Fire Station'), false);
  assert.equal(CORE.namesSimilar('Fire Station', 'Plymouth Fire Station'), true); // generic name: location decides
});

test('alliance: clustering nearby buildings of one category with similar names', () => {
  const b = (id, name, lat, lng, cat, owner) => ({ id, name, lat, lng, cat, owner });
  const list = [
    b(1, 'Truro Fire Station', 50.2600, -5.0500, 'fire', 10),
    b(2, 'Truro FS', 50.2610, -5.0505, 'fire', 11), // ~115 m away
    b(3, 'Truro Fire', 50.2605, -5.0510, 'fire', 12),
    b(4, 'Truro Ambulance Station', 50.2601, -5.0501, 'ambulance', 13), // other category
    b(5, 'Redruth Fire Station', 50.2602, -5.0502, 'fire', 14), // different name
    b(6, 'Bodmin Fire Station', 50.4700, -4.7200, 'fire', 15), // alone
    b(7, 'Bodmin Fire Station', 50.4701, -4.7201, 'fire', 15), // same owner twice counts once
  ];
  const groups = CORE.clusterBuildings(list, { radiusM: 250, minCount: 2 });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].name, 'Truro Fire Station'); // names tie on count, so the longest wins
  assert.equal(groups[0].cat, 'fire');
  assert.deepEqual(groups[0].members.map((m) => m.id).sort(), [1, 2, 3]);
  assert.ok(Math.abs(groups[0].lat - 50.2605) < 0.001);
  // Without the name check Redruth joins; min 1 keeps singles.
  const loose = CORE.clusterBuildings(list, { radiusM: 250, minCount: 1, requireSimilarNames: false });
  assert.equal(loose.find((g) => g.cat === 'fire' && g.count >= 3).count, 4);
  assert.equal(loose.length, 3); // Truro fire group, ambulance, Bodmin
});
