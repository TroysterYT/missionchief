#!/usr/bin/env node
/**
 * Builds the "which vehicle types count for which mission requirement" table used by the readiness report.
 *
 * Source: LSS-Manager (https://github.com/LSS-Manager/lssm-v.4), licensed CC BY-NC-SA 4.0. Its call-window module
 * lists, per requirement as the game words it, the vehicle type ids that satisfy it. The game's mission list uses
 * codes instead (e.g. `platform_trucks`), so JOIN below links each code to those requirement texts.
 *
 * Usage: node scripts/build-substitutions.js /path/to/lssm-v.4 [--write]
 *   --write replaces the generated block in missionchief-readiness.user.js; otherwise the table is printed.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Mission requirement code → requirement texts (as in LSS-Manager's en_GB vehiclesByRequirement) whose vehicles count.
const JOIN = {
  en_GB: {
    firetrucks: ['Fire engine'],
    platform_trucks: ['Aerial Appliance Truck'],
    battalion_chief_vehicles: ['Fire Officer'],
    heavy_rescue_vehicles: ['Rescue Support Unit or Rescue Pump'],
    mobile_air_vehicles: ['BASU'],
    water_tankers: ['Water Carrier'],
    mobile_command_vehicles: ['ICCU or Ambulance Control Unit'],
    hazmat_vehicles: ['HazMat Unit or CBRN Vehicle'],
    ambulances: ['Ambulance'],
    police_cars: ['Police car'],
    helicopter: ['HEMS'],
    rth: ['HEMS'],
    police_helicopters: ['Policehelicopter'],
    swat_suv: ['Armed Response'],
    k9: ['Dog Support Unit (DSU)'],
    kdow_orgl: ['Operational Team Leader'],
    traffic_car: ['Traffic Car'],
    atv_carrier: ['ATV Carrier'],
    hazard_response_primary: ['Primary Response Vehicle'],
    hazard_response_secondary: ['Secondary Response Vehicle'],
    emergency_welfare: ['Welfare Vehicle'],
    ems_mobile_command: ['Ambulance Officer'],
    foam: ['Foam Unit'],
    mass_casualty_equipment: ['Mass Casualty Equipment'],
    police_horse: ['Mounted Unit'],
    water_rescue: ['4x4 Vehicle'],
    height_rescue_units: ['Coastguard Rope Rescue Unit'],
    flood_equipment: ['Flood Rescue Unit'],
    coastal_rescue: ['CRV'],
    coastal_command: ['Coastguard Commander'],
    coastal_boat: ['Boat Trailer or Inland Rescue Boat'],
    large_coastal_boat: ['ILB'],
    coastal_guard_boat: ['ALB'],
    coastal_helicopter: ['Coastguard Rescue Helicopter'],
    mud_rescue: ['Mud Decontamination Unit'],
    coastal_support: ['Support Unit'],
    coastal_jetski: ['Rescue Watercraft (Trailer)'],
    coastal_mud_rescue: ['Coastguard Mud Rescue Unit'],
    coastal_boat_hover: ['Hovercraft (trailer)'],
    arff: ['Major Foam Tender'],
    riv: ['RIV'],
    rettungstreppe: ['Rescue Stair'],
    elw_airport: ['Airfield Firefighting Command Vehicle'],
    airport_equipment: ['Airfield Operations Vehicle'],
    airport_command: ['Airfield Operations Supervisor'],
    search_and_rescue: ['Operational Support Van, Trailer or Personal SAR Vehicle'],
    search_and_rescue_command: ['Control Van'],
    midwife: ['Community Midwife'],
    rescue_dogs: ['Rescue Dog'],
    two_way: ['Road Rail Unit'],
    railway_police: ['EIU'],
    bomb_disposal_command: ['EOD Commander'],
    bomb_disposal_crew: ['EOD Response Vehicle'],
    bomb_disposal_equipment: ['EOD Medium Equipment Van'],
    bomb_disposal_heavy_equipment: ['EOD Heavy Equipment Vehicle'],
    bomb_disposal_diver_crew: ['Marine EOD Response Vehicle'],
    bomb_disposal_diver_equipment: ['Marine EOD Equipment Van'],
    oneof_fire_engine_or_airport_fire_engine: ['Fire Engine or RIV'],
    oneof_fire_engine_or_airport_fire_engine_large: ['Fire engine', 'Major Foam Tender'],
    oneof_fire_engine_or_airport_fire_engine_or_engine_large: ['Fire Engine or RIV', 'Major Foam Tender'],
    oneof_airport_fire_engine_or_engine_large: ['RIV', 'Major Foam Tender'],
    oneof_fire_engine_or_rescue: ['Fire engine or Rescue Support Vehicle'],
    oneof_fire_engine_or_rescue_or_ladder: ['Fire engine, Rescue Support Vehicle or Aerial Appliance Truck'],
    oneof_fire_ladder_or_rescue_stairs: ['Aerial Appliance Truck or Rescue Stairs'],
    oneof_fire_command_or_airport_fire_command: ['Fire Officer'],
    oneof_fire_command_advanced_or_airport_fire_command: ['ICCU or Ambulance Control Unit'],
    oneof_coastal_guard_boat_or_boat_large: ['ILB or ALB'],
    oneof_police_patrol_or_swat: ['Police Car or Armed Response Vehicle (ARV)'],
    oneof_police_drone_or_helicopter: ['Police Helicopter or Drone', 'Drone'],
    oneof_mountain_atv_or_search_and_rescue_atv: ['Mountain Rescue 4x4', '4x4 Vehicle'],
    oneof_paramedic_or_paramedic_advanced: ['Specialist Paramedic RRV', { ids: [94] }], // 94 = RRV, not listed on its own
  },
};

// Per-mission "also allowed" rules (mission.additional flags) → extra requirement texts for a code.
const ALTERNATIVES = {
  en_GB: {
    allow_rw_instead_of_lf: { firetrucks: ['Fire engine or Rescue Support Vehicle'] },
    allow_arff_instead_of_lf: { firetrucks: ['RIV', 'Major Foam Tender'] },
  },
};

function build(lssm, locale) {
  const file = path.join(lssm, 'src/modules/extendedCallWindow/i18n', `${locale}.json`);
  const list = JSON.parse(fs.readFileSync(file, 'utf8')).enhancedMissingVehicles.vehiclesByRequirement;
  const byText = new Map();
  for (const r of list) for (const t of r.texts) byText.set(t.toLowerCase(), r.vehicles);
  const resolve = (parts, code) => {
    const ids = new Set();
    for (const p of parts) {
      if (typeof p === 'object') {
        p.ids.forEach((i) => ids.add(i));
        continue;
      }
      const v = byText.get(p.toLowerCase());
      if (!v) throw new Error(`${locale}: no requirement text "${p}" (for ${code}) in ${file}`);
      v.forEach((i) => ids.add(i));
    }
    return [...ids].sort((a, b) => a - b);
  };
  const req = {};
  for (const [code, parts] of Object.entries(JOIN[locale])) req[code] = resolve(parts, code);
  const alt = {};
  for (const [flag, codes] of Object.entries(ALTERNATIVES[locale] || {})) {
    alt[flag] = {};
    for (const [code, parts] of Object.entries(codes)) alt[flag][code] = resolve(parts, `${flag}.${code}`);
  }
  let version = '';
  try {
    version = JSON.parse(fs.readFileSync(path.join(lssm, 'package.json'), 'utf8')).version;
  } catch (e) { /* optional */ }
  return { req, alt, version };
}

function main() {
  const [lssm, flag] = process.argv.slice(2);
  if (!lssm) {
    console.error('Usage: node scripts/build-substitutions.js /path/to/lssm-v.4 [--write]');
    process.exit(1);
  }
  const out = {};
  let version = '';
  for (const locale of Object.keys(JOIN)) {
    const b = build(lssm, locale);
    out[locale] = { req: b.req, alt: b.alt };
    version = b.version;
  }
  const block = `  // BEGIN GENERATED SUBSTITUTIONS: node scripts/build-substitutions.js <lssm-v.4 checkout> --write\n`
    + `  // Derived from LSS-Manager ${version} (https://github.com/LSS-Manager/lssm-v.4), CC BY-NC-SA 4.0.\n`
    + `  const SUBSTITUTIONS = ${JSON.stringify(out)};\n`
    + '  // END GENERATED SUBSTITUTIONS\n';
  if (flag !== '--write') {
    process.stdout.write(block);
    return;
  }
  const target = path.join(__dirname, '..', 'missionchief-readiness.user.js');
  const src = fs.readFileSync(target, 'utf8');
  const re = /  \/\/ BEGIN GENERATED SUBSTITUTIONS[\s\S]*?\/\/ END GENERATED SUBSTITUTIONS\n/;
  if (!re.test(src)) throw new Error('generated block markers not found in missionchief-readiness.user.js');
  fs.writeFileSync(target, src.replace(re, block));
  console.log(`Updated ${target} from LSS-Manager ${version}`);
}

main();
