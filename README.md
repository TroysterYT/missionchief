# missionchief

Userscripts for [MissionChief](https://www.missionchief.com) and its sister games.

## Map Filter & Coverage

`missionchief-map-filter.user.js` adds a filter button (funnel icon) under the zoom buttons on the main map. It opens a panel with four tabs.

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
- **Name or ID search**

Chips cycle through **require → exclude → off**. Right-click a chip to exclude it straight away. Each group can match **any** or **all** of its chips, and all groups must pass together.

Buildings that don't match can be hidden, dimmed or left alone. Matches can get a colored ring whose popup lists vehicles, extensions and training, and links to the building. You can also zoom the map to the matches or export them to CSV.

### Coverage

Add as many coverage layers as you like. Each layer draws a radius around a set of stations, chosen by building type, by vehicle type (for example every station with an ALS ambulance), or by whatever the Filters tab currently matches. Set the radius directly in km or miles, or work it out from minutes at an average speed.

Gap analysis for one layer can:

- shade the uncovered parts of the current view and report the covered percentage
- ring missions on the map that fall outside coverage

Coverage uses straight-line distance, not road travel time.

### Staff

The game API has no staff-training data. This tab opens each staffed building's personnel page in the background, one at a time with a configurable delay, and reads the training column. Results are cached in your browser and rescanned once they are older than the age you set.

### Presets

Save named filter sets and apply them later. You can also export all settings to JSON and import them again.

### Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey.
2. Open the [raw script](https://raw.githubusercontent.com/TroysterYT/missionchief/main/missionchief-map-filter.user.js) and click **Install**.
3. Reload the game.

It runs alongside LSS-Manager. Type names come from the public LSS-Manager API, and the script falls back to type IDs if that API is unreachable.

### Development

```sh
npm test   # unit tests for the filter and coverage logic (Node 21+)
```
