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
