'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../missionchief-readiness.user.js');

// Shaped like the game's /einsaetze.json (array form), with a variant overlay and odd values.
const raw = [
  { id: 0, name: 'Bin fire', average_credits: 200, prerequisites: { fire_stations: 1 }, requirements: { firetrucks: 1 }, additional: {} },
  { id: 1, name: 'House fire', average_credits: 1500, prerequisites: { fire_stations: 2 }, requirements: { firetrucks: 2, platform_trucks: 1 }, additional: { possible_patient: 2 } },
  { id: 2, name: 'Chemical spill', average_credits: 3000, prerequisites: { fire_stations: 5 }, requirements: { firetrucks: 2, hazmat_vehicles: 1 }, additional: { personnel_educations: { hazmat: 6 } } },
  { id: '3/a', name: 'Crash (with patient)', average_credits: 900, prerequisites: { main_building: 2, fire_stations: 1, ambulance_stations: 1 }, requirements: { ambulances: '1', unknown_thing: 1 }, additional: { patient_specializations: 'Trauma Surgery' } },
  { id: 4, name: 'Big incident', prerequisites: { fire_stations: 3, police_stations: 4 }, requirements: {}, additional: {} },
  null,
];

test('normalizeMissions handles arrays, objects, strings and main_building 0', () => {
  const ms = R.normalizeMissions(raw);
  assert.equal(ms.length, 5);
  assert.deepEqual(ms[3].req, { ambulances: 1, unknown_thing: 1 });
  assert.equal(ms[3].mainBuilding, 2);
  assert.equal(ms[3].overlay, true);
  assert.deepEqual(ms[3].specs, ['Trauma Surgery']);
  assert.deepEqual(ms[2].edu, { hazmat: 6 });
  assert.equal(R.normalizeMissions({ 7: { name: 'X', prerequisites: { main_building: 0 } } })[0].mainBuilding, 0);
  assert.equal(R.normalizeMissions({ 7: { name: 'X' } })[0].id, '7');
});

test('autoMap matches UK and US vehicle names, with exclusions', () => {
  const veh = [
    { id: 0, caption: 'Water Ladder' }, { id: 1, caption: 'Fire Officer' }, { id: 2, caption: 'Aerial Appliance' },
    { id: 3, caption: 'Hazardous Materials Unit' }, { id: 4, caption: 'Ambulance' }, { id: 5, caption: 'Air Ambulance' },
    { id: 6, caption: 'Incident Response Vehicle' }, { id: 7, caption: 'Police Helicopter' }, { id: 8, caption: 'Type 1 fire engine' },
    { id: 9, caption: 'Water Carrier' },
  ];
  assert.deepEqual(R.autoMap('firetrucks', veh), [0, 8]);
  assert.deepEqual(R.autoMap('platform_trucks', veh), [2]);
  assert.deepEqual(R.autoMap('battalion_chief_vehicles', veh), [1]);
  assert.deepEqual(R.autoMap('hazmat_vehicles', veh), [3]);
  assert.deepEqual(R.autoMap('ambulances', veh), [4]);
  assert.deepEqual(R.autoMap('police_cars', veh), [6]);
  assert.deepEqual(R.autoMap('water_tankers', veh), [9]);
  assert.deepEqual(R.autoMap('something_else', veh), []);
  const bld = [{ id: 0, caption: 'Fire Station' }, { id: 18, caption: 'Fire Station (Small)' }, { id: 5, caption: 'Police Station' }];
  assert.deepEqual(R.autoMap('fire_stations', bld), [0, 18]);
  assert.deepEqual(R.autoMap('police_stations', bld), [5]);
});

test('specCovered matches hospital extensions loosely', () => {
  assert.equal(R.specCovered('Trauma Surgery', ['Trauma Surgery', 'General Internal']), true);
  assert.equal(R.specCovered('Trauma Surgery', ['Trauma']), true);
  assert.equal(R.specCovered('Neurology', ['General Internal']), false);
});

test('analyze: unlocks, shortfalls, next-build plan and unknown keys', () => {
  const missions = R.normalizeMissions(raw);
  const res = R.analyze({
    missions,
    buildingCounts: { 0: 3, 2: 1 }, // 3 fire stations, 1 ambulance station, no police
    vehicleCounts: { 10: 4, 11: 0, 12: 2 },
    trainingCounts: { 'HazMat': 2 },
    hospitalExtensions: ['General Internal'],
    maps: {
      prereq: { fire_stations: ['0'], ambulance_stations: ['2'], police_stations: ['5'] },
      req: { firetrucks: ['10'], platform_trucks: ['11'], hazmat_vehicles: ['13'], ambulances: ['12'] },
      edu: { hazmat: ['HazMat'] },
    },
  });
  assert.equal(res.total, 5);
  const byName = Object.fromEntries(res.rows.map((r) => [r.m.name, r]));
  assert.equal(byName['Bin fire'].unlocked, true);
  assert.equal(byName['Chemical spill'].unlocked, false); // needs 5 fire stations
  assert.equal(byName['Big incident'].missing.length, 1); // only police stations missing
  assert.equal(res.unlocked, 3);
  assert.equal(res.covered, 1); // bin fire; house fire lacks platform, crash lacks trauma
  const gapKeys = res.gaps.map((g) => `${g.kind}:${g.key}`);
  assert.deepEqual(gapKeys.sort(), ['specialization:Trauma Surgery', 'vehicle:platform_trucks']);
  assert.deepEqual(res.unknown.req, ['unknown_thing']);
  const plan = Object.fromEntries(res.unlocks.map((u) => [u.key, u]));
  assert.deepEqual(plan.fire_stations.steps, [{ extra: 2, unlocks: 1 }]);
  assert.deepEqual(plan.police_stations.steps, [{ extra: 4, unlocks: 1 }]);
});

test('analyze: missing main building blocks the mission; no staff data means training unknown', () => {
  const missions = R.normalizeMissions([{ id: 1, name: 'M', prerequisites: { main_building: 9 }, requirements: {}, additional: { personnel_educations: { swat: 2 } } }]);
  const res = R.analyze({ missions, buildingCounts: {}, vehicleCounts: {}, trainingCounts: null, hospitalExtensions: [], maps: { prereq: {}, req: {}, edu: { swat: ['SWAT'] } } });
  assert.equal(res.unlocked, 0);
  assert.deepEqual(res.rows[0].missing, [{ key: 'main_building:9', need: 1, have: 0 }]);
  assert.deepEqual(res.unknown.edu, ['swat']);
});

test('localShortfall counts vehicles at nearby stations', () => {
  const st = [
    { id: 1, name: 'A', lat: 50, lng: -4, vehicles: { 3: 1 } },
    { id: 2, name: 'B', lat: 50.05, lng: -4, vehicles: {} }, // ~5.6 km from A
    { id: 3, name: 'C', lat: 51, lng: -4, vehicles: {} }, // ~111 km away
  ];
  const weak = R.localShortfall(st, ['3'], 1, 10);
  assert.deepEqual(weak.map((s) => [s.name, s.have]), [['C', 0]]);
  assert.deepEqual(R.localShortfall(st, ['3'], 2, 10).map((s) => s.name), ['C', 'A', 'B']);
});

test('analyze: leaving out hospitals ignores their requirements and specialties', () => {
  const missions = R.normalizeMissions([
    { id: 1, name: 'Needs hospital', prerequisites: { hospitals: 1, fire_stations: 1 }, requirements: {}, additional: { patient_specializations: 'Trauma' } },
    { id: 2, name: 'Hospital main building', prerequisites: { main_building: 4 }, requirements: {}, additional: {} },
    { id: 3, name: 'Fire or hospital', prerequisites: { big_buildings: 2 }, requirements: {}, additional: {} },
  ]);
  const base = {
    missions, buildingCounts: { 0: 1, 4: 5 }, vehicleCounts: {}, trainingCounts: null, hospitalExtensions: [],
    maps: { prereq: { hospitals: ['4'], fire_stations: ['0'], big_buildings: ['0', '4'] }, req: {}, edu: {} },
  };
  const all = R.analyze(base);
  assert.equal(all.gaps.length, 1); // Trauma specialty missing
  assert.equal(all.unlocked, 3);
  const noHosp = R.analyze({ ...base, buildingCounts: { 0: 1 }, skip: { buildingTypes: [4], specs: true } });
  assert.equal(noHosp.gaps.length, 0);
  assert.equal(noHosp.rows[0].unlocked, true); // hospital requirement ignored
  assert.equal(noHosp.rows[1].unlocked, true); // hospital main building ignored
  assert.deepEqual(noHosp.rows[2].missing, [{ key: 'big_buildings', need: 2, have: 1 }]); // only fire stations count now
  assert.deepEqual(noHosp.unlocks.map((u) => u.key), ['big_buildings']);
});

test('autoMap: dual-role vehicles count for each role they cover', () => {
  const veh = [
    { id: 0, caption: 'Water Ladder' }, { id: 2, caption: 'Aerial Appliance' },
    { id: 20, caption: 'CARP' }, { id: 21, caption: 'Combined Aerial Rescue Pump' },
    { id: 30, caption: 'Quint' }, { id: 31, caption: 'Rescue Engine' }, { id: 32, caption: 'Heavy Rescue Vehicle' },
    { id: 40, caption: 'Vehicle type 99 / CARP' }, // game name unknown, but you called it CARP
  ];
  assert.deepEqual(R.autoMap('platform_trucks', veh), [2, 20, 21, 30, 40]);
  for (const id of [0, 20, 21, 30, 31, 40]) assert.ok(R.autoMap('firetrucks', veh).includes(id), `firetrucks should include ${id}`);
  assert.deepEqual(R.autoMap('heavy_rescue_vehicles', veh), [31, 32]);
});
