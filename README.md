# missionchief

Userscripts for [MissionChief](https://www.missionchief.com) and its sister games.

## Map Filter & Coverage

`missionchief-map-filter.user.js` adds a filter button (funnel icon) under the zoom buttons on the main map. It opens a panel with six tabs.

### Filters

Filter your buildings on the map by:

- **Building type**
- **Extensions**: built, built and enabled, under construction, or any of these
- **Specializations**: only if the game API reports them. Hospital specialties are extensions.
- **Vehicles**: vehicle types at the station, with a minimum count per type
- **Vehicle status right now**, for example "has a vehicle at station" (status 2)
- **Staff training**: needs a one-time scan on the Staff tab
- **Dispatch center**
- **Personnel, level and vehicle-count ranges**
- **Flags**: below personnel goal, hiring active, shared with alliance, small building
- **Inside or outside your selected areas** (see Areas)
- **Name or ID search**

Chips cycle through **require → exclude → off**. Right-click a chip to exclude it straight away. Each group can match **any** or **all** of its chips, and all groups must pass together.

Buildings that don't match can be hidden, dimmed or left alone. Matches can get a colored ring whose popup lists vehicles, extensions and training, and links to the building. You can also zoom the map to the matches or export them to CSV.

### Coverage

Add as many coverage layers as you like. Each layer draws a radius around a set of stations, chosen by building type, by vehicle type (for example every station with an ALS ambulance), or by whatever the Filters tab currently matches. Set the radius directly in km or miles, or work it out from minutes at an average speed.

Gap analysis for one layer can:

- shade the uncovered parts of the current view and report the covered percentage
- ring missions on the map that fall outside coverage

Coverage uses straight-line distance, not road travel time.

It can also shade gaps across your whole selected areas instead of only the current view, and report how much of those areas is covered.

### Areas

Select areas to outline on the map while you plan where to build:

- **US counties**: choose a state (or use the state in the middle of the map), then tick counties in the list or click them on the map. Boundaries come from the US Census via the `us-atlas` package, accurate to roughly 300 m.
- **UK counties** (MissionChief UK): England's 48 ceremonial counties, Wales's 22 principal areas, Scotland's 32 council areas and Northern Ireland's 6 counties. Tick them in the list or click them on the map. Boundaries come from OpenStreetMap: each one downloads the first time you select it, and the whole list downloads in about a minute if you want to click counties on the map. They are then saved in your browser.
- **Any other area**: search OpenStreetMap for cities, townships, counties or districts anywhere, for example UK counties on MissionChief UK.

Turn the outlines on and off with the map button under the filter button, or **Show on map** on the Areas tab. Hidden areas still count for the area filter, stats and gap shading.

For each selected area you see its size, the buildings inside it by type, the missions in it right now, and the percentage covered by the coverage layer chosen for gap analysis. Selected areas are remembered.

### Sites

Finds emergency service sites to build inside your selected areas. There are two sources:

- **Where alliance members have built** (default): looks at other players' buildings and flags spots where several members built the same kind of building close together, optionally only when the names are similar. Those are very likely real stations. You can set the distance, how many members must have built there, and whether names must be similar.

  The game only loads other players' buildings near where you're looking, and more as you zoom in. The script remembers every one that appears while you browse (saved in your browser), and **Scan my areas** moves the map across your selected areas at a zoom you choose to load them all, then puts the map back. Zoom in until all buildings show, press **Use current**, then scan.
- **OpenStreetMap**: real sites from the map data. The tab shows how many results came back at each step, and a clear message when OpenStreetMap is too busy to answer.

The OpenStreetMap source covers: fire, ambulance and police stations, hospitals (A&E marked), coastguard and lifeboat stations, air ambulance and police helicopter bases, and mountain and cave rescue. Sites where you already have a building of the matching type nearby (500 m by default) are hidden, so the list shows what's left to build.

Each site is a dot on the map. **Show** zooms onto the site and rings it so you can place your building there. You can export the list to CSV.

### Staff

The game API has no staff-training data. This tab opens each staffed building's personnel page in the background, one at a time with a configurable delay, and reads the training column. Results are cached in your browser and rescanned once they are older than the age you set.

### Presets

Save named filter sets and apply them later. You can also export all settings to JSON and import them again.

### Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey.
2. Open the [raw script](https://raw.githubusercontent.com/TroysterYT/missionchief/main/missionchief-map-filter.user.js) and click **Install**.
3. Reload the game.

It runs alongside LSS-Manager. Type names come from the public LSS-Manager API, and the script falls back to type IDs if that API is unreachable.

## Readiness Report

`missionchief-readiness.user.js` is a separate script for occasional use. It adds nothing to the game page: open it from the **Tampermonkey menu → Open readiness report** (or press Alt+Shift+R on the map page). It loads your buildings, vehicles and the game's full mission list, then shows:

- **Overview**: how many mission types you've unlocked, and how many of those your own fleet can fully handle.
- **Where you're short**: vehicles, staff training and hospital specialties that missions you can already get need, but you don't have enough of. Sorted by how many mission types are affected.
- **What to build next**: mission types blocked by a single building requirement, e.g. "Police stations +1 → 1 mission".
- **Weak areas**: for each vehicle requirement, which of your stations don't have enough of it within a distance you set (20 km by default), with a button to show each one on the map.
- **Housekeeping**: buildings below their personnel goal, vehicles out of service, and stations with no vehicles.

**Leave out hospitals** drops hospital building requirements, hospital specialty shortfalls and hospitals in housekeeping from the report. The setting is remembered.

Staff training needs a staff scan. The report shares the scan results with the map filter script, so stations scanned there count here too.

The mission list names requirements with internal codes (for example `firetrucks`), which the report matches to your game's names automatically. **How requirements were matched** shows every match. Click names on or off to fix one, and your changes are saved. **Export** saves the whole report as JSON.

### Install

With Tampermonkey enabled, open the [raw readiness script](https://raw.githubusercontent.com/TroysterYT/missionchief/main/missionchief-readiness.user.js) and click **Install**, then reload the game.

Each script has its own link. Tampermonkey shows **Update** when a newer version is available, and **Reinstall** when you already have the latest one.

### Development

```sh
npm test   # unit tests for the filter and coverage logic (Node 21+)
```
