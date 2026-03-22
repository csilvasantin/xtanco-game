# CODEX.md -- XTANCO Digital Twin Game

> Machine-readable project reference for AI agents (Codex, GPT, Claude, etc.).
> Single-file HTML5 Canvas game. No build step, no dependencies.

## 1. 2. 3. Basic Priority

1. Read `onboarding` and project context first.
2. Preserve the digital twin direction and avoid random rewrites.
3. End relevant work with HTML plus a public URL that can be checked.

If `Nomeacuerd0` appears on a public page, treat it only as a light access barrier.

---

## 1. Project Overview

**XTANCO** is a Kairosoft-style isometric shop management simulator rendered entirely in a single HTML file using the Canvas 2D API. The player manages a Spanish tobacco shop ("estanco") over 5 in-game years: hiring staff, restocking products, running advertisements, and hitting annual revenue targets.

**Tech stack:**
- Vanilla JavaScript (ES6+), no frameworks or libraries
- HTML5 `<canvas>` at 800x500 logical resolution, pixel-art style (`image-rendering: pixelated`)
- Optional Node.js CORS proxy for Elgato Key Light hardware integration
- Persistence via `localStorage` (game save + layout editor)
- Bilingual: Spanish (`es`) and English (`en`) via `LANGS` i18n object

**File structure:**
| File | Purpose |
|------|---------|
| `index.html` | Entire game (HTML + CSS + JS, ~2716 lines) |
| `elgato-proxy.js` | Node.js CORS proxy for Elgato Key Light API |
| `README.md` | Spanish project overview |
| `DIARY.md` | Development diary |

---

## 2. Architecture

### Single-file structure (index.html)

The `<script>` block (lines 18-2714) is organized top-to-bottom:

| Section | Lines (approx.) | Contents |
|---------|-----------------|----------|
| Canvas setup | 22-44 | Canvas init, responsive resize, touch support |
| Elgato integration | 46-105 | Key Light toggle, fetch with fallback URLs |
| CFG constants | 108-122 | Game balance: timings, costs, probabilities |
| Palette P | 124-144 | All color hex values (Kairosoft warm style) |
| MODELS | 147-237 | 4 shop model configs (Generic/Good/Better/Best) |
| I18N (LANGS) | 241-344 | es/en translation objects |
| State enum S | 347-349 | 8 game states |
| Layout system | 352-440 | Furniture positions, editor, collision |
| Game state G | 442-507 | initGame(), saveGame(), loadGame() |
| Input handling | 509-635 | Keyboard + mouse/touch event listeners |
| Actions | 637-700 | doAction() dispatcher for all UI buttons |
| Game logic | 709-935 | updateGame(), endWeek(), advanceYear(), spawnCust() |
| Draw helpers | 937-944 | r(), rx(), tx(), glow(), nog(), nl(), nt() |
| Shop/ISO layout | 946-963 | SHOP rect, ISO config object |
| Iso engine | 964-1031 | toIso(), drawIsoTile(), drawIsoBlock(), drawIsoShadow() |
| Chibi renderer | 1033-1068 | chibi() -- pixel-art character sprite |
| Menu screens | 1070-1187 | drawMenu(), drawModelSelect(), drawTutorial() |
| City background | 1189-1308 | CITY_BUILDINGS[], drawIsoCityBuilding(), drawCityBg() |
| Shop renderer | 1310-1605 | drawShop() -- walls, floor, windows, door, entities |
| Wall elements | 1607-1823 | drawLED(), drawWallClock(), drawTFTScreen() |
| Furniture draw fns | 1825-2074 | drawIsoCounter/Shelves/Lottery/Manager/Plant/etc. |
| Entity renderers | 2076-2115 | drawIsoStaff(), drawIsoCust() |
| HUD + UI | 2125-2425 | drawHUD(), drawBottomBar(), drawUI(), tab functions |
| Overlays | 2427-2537 | drawPause(), drawYearEnd(), drawGameEnd() |
| Editor mode | 2539-2692 | drawEditor(), playSaveBeep() |
| Main loop | 2694-2713 | loop() -- requestAnimationFrame entry point |

### Main loop (line 2694)

```
function loop() {
  requestAnimationFrame(loop);
  tt++;                          // global tick counter
  cx.clearRect(0,0,W,H);
  // State dispatch:
  //   MENU -> drawMenu()
  //   MODEL_SEL -> drawModelSelect()
  //   TUT -> drawTutorial()
  //   YEAR_END -> drawYearEnd()
  //   GAME_END -> drawGameEnd()
  //   EDITOR -> drawEditor()
  //   PAUSE -> draw game bg + drawPause() overlay
  //   GAME -> updateGame() + full render pipeline
}
```

---

## 3. Isometric Engine

### ISO config (line 957)

```js
const ISO = {
  tileW: 88,       // tile width in pixels (wide diamond)
  tileH: 30,       // tile height in pixels
  cols: 12,        // grid columns
  rows: 6,         // grid rows
  ox: 340,         // origin X offset (screen pixels)
  oy: 198,         // origin Y offset (screen pixels)
  wallH: 170,      // wall height in pixels
  doorCol: 11,     // door grid position
  doorRow: 3,
};
```

### Key functions

| Function | Line | Signature | Purpose |
|----------|------|-----------|---------|
| `toIso` | 965 | `(col, row) -> {x, y}` | Grid coord to screen pixel |
| `drawIsoTile` | 972 | `(col, row, color, strokeColor)` | Flat diamond tile |
| `drawIsoBlock` | 985 | `(col, row, bw, bd, bh, topCol, leftCol, rightCol, neonCol)` | 3D isometric box with optional neon edge glow |
| `drawIsoShadow` | 1026 | `(sx, sy, rw, rh)` | Elliptical ground shadow |
| `screenToIso` | 409 | `(sx, sy) -> {col, row}` | Screen pixel to grid coord (for mouse/collision) |

### Coordinate system

- Origin `(ISO.ox, ISO.oy)` is the top corner of tile `(0,0)`
- **col** increases to the right (screen-right + down)
- **row** increases to the left (screen-left + down)
- `toIso(col,row).x = ox + (col-row)*tileW/2`
- `toIso(col,row).y = oy + (col+row)*tileH/2`

---

## 4. Game States

Defined at line 347:

```js
const S = {
  MENU: 'menu',           // Language selection screen
  MODEL_SEL: 'modelSel',  // Choose shop model (4 cards)
  TUT: 'tutorial',        // 3-page tutorial slides
  GAME: 'game',           // Main gameplay
  PAUSE: 'pause',         // Weekly summary overlay
  YEAR_END: 'yearEnd',    // Animated year-end results + rating
  GAME_END: 'gameEnd',    // Final score + rank
  EDITOR: 'editor',       // Layout editor mode
};
```

**State transitions:**
```
MENU -> MODEL_SEL (Enter/Space, picks language)
MODEL_SEL -> TUT (Enter/Space/click on card, calls initGame())
TUT -> GAME (after 3 pages)
GAME -> PAUSE (Escape)
GAME -> EDITOR (E key)
GAME -> YEAR_END (when week > WEEKS_PER_YEAR)
GAME -> GAME_END (revenue < target * 0.55)
YEAR_END -> GAME (Enter after anim, calls advanceYear())
YEAR_END -> GAME_END (year 5 complete)
GAME_END -> MENU (Enter/Space)
EDITOR -> GAME (Escape / Exit button)
PAUSE -> GAME (Escape/Enter/click)
```

---

## 5. Models

Four shop types defined in `MODELS[]` (lines 147-237). Selected via `activeModel`/`modelSel`.

| Index | ID | Difficulty | Staff | Products | Start Money | Neon Color |
|-------|----|-----------|-------|----------|-------------|------------|
| 0 | `generic` | Normal (3 stars) | 4 | 6 | 3500 | `#00ffcc` |
| 1 | `good` | Easy (2 stars) | 2 | 4 | 2800 | `#44ff44` |
| 2 | `better` | Hard (4 stars) | 5 | 6 | 4500 | `#4488ff` |
| 3 | `best` | Expert (5 stars) | 6 | 8 | 6000 | `#ffcc00` |

Each model overrides: `START_MONEY`, `YEAR_TARGETS[5]`, `SALE_PROB`, `SALE_BASE`, `RUSH_CHANCE`, `RUSH_DURATION`, `RUSH_MULT`, `INSPECT_CHANCE`, `HIRE_COST[]`, `TRAIN_COST[]`, `SALARY[]`, `RESTOCK_COST`, `UPGRADE_COST`, `ADVERT[]`, `staffInit[]`, `prodsInit[]`.

On `initGame()` (line 444), the selected model's values are copied into the global `CFG` object.

---

## 6. Layout System

### DEFAULT_LAYOUT (line 354)

Array of furniture placement objects:

```js
{ id: 'counter', type: 'counter', col: 1, row: 1, sx: 1, sy: 1, label: 'Mostrador' }
```

- `col`/`row`: position on ISO grid
- `sx`/`sy`: scale factors (editor-adjustable, 0.2 to 3.0)
- `type`: links to draw function and FURNITURE_SIZE

Default items: counter, shelves, wineRack, lottery, vending, magazines, manager, plant1-4, rug, floorLamp, led, tft.

### localStorage persistence

- `loadLayout()` (line 376): reads `xtanco_layout`, merges with defaults for migration
- `saveLayout()` (line 399): writes current `shopLayout` to `xtanco_layout`
- `resetLayout()` (line 402): deep-copies DEFAULT_LAYOUT, saves
- Game save: `xtanco_save` key stores `{G, lang, state}`

### Editor mode

Entered with `E` key during GAME state. Features:
- Click tile to move selected furniture
- Arrow keys move selected item; Shift+Arrow resizes (sx/sy)
- `S` key saves layout; `R` key resets to defaults
- Bottom panel lists all items with position/scale info
- Save confirmation: green flash border + toast + two-tone beep (`playSaveBeep()`, line 2545)

---

## 7. Collision System

### FURNITURE_SIZE (line 417)

Footprint in tiles `[width, depth]`:

```js
const FURNITURE_SIZE = {
  counter: [1,2], shelves: [1,2], wineRack: [2,1], lottery: [2,1],
  vending: [1,1], magazines: [2,1], manager: [2,1], plant: [1,1],
  floorLamp: [1,1], rug: [2,2],
};
```

### Key functions

| Function | Line | Purpose |
|----------|------|---------|
| `isTileBlocked(col, row)` | 424 | Checks if tile overlaps any furniture footprint. Skips `rug`, `led`, `tft` (walkable). |
| `canWalkTo(screenX, screenY)` | 435 | Converts screen coords to ISO grid, checks bounds + `isTileBlocked`. |

Used by: player movement (line 799), customer pathfinding (lines 883-896), customer spawning (line 925).

---

## 8. Rendering Pipeline

During GAME state, `loop()` calls (line 2709-2711):

```
1. updateGame()           -- tick all game logic
2. r(0,0,W,H,P.bg)       -- clear with background color
3. drawCityBg()           -- sky gradient, clouds, isometric city buildings, street tiles
4. drawShop()             -- floor tiles, 3 walls, windows, door, wall elements, depth-sorted entities
5. drawShopChars()        -- (legacy no-op, entities drawn inside drawShop)
6. drawFloats()           -- floating text (damage numbers, sale amounts)
7. drawEvent()            -- event message banner (rush hour, inspection, etc.)
8. drawElgatoNotify()     -- Elgato light status toast
9. drawHUD()              -- top bar (year/week, money, rush badge, objective bar)
10. drawBottomBar()       -- bottom bar (save, sales, profit, satisfaction, menu)
11. drawUI()              -- overlay panel (4 tabs: Sales/Staff/Stock/Store)
```

---

## 9. Entity System

Inside `drawShop()` (line 1545), all entities are collected into a single array for depth sorting:

```js
const entities = [];
// Furniture from shopLayout (skip led, tft which are wall-mounted)
// Rugs get depth -999 (always behind everything)
// Staff (hired only) -- depth = s.y + 27 (feet position)
// Customers -- depth = c.y + 20
entities.sort((a, b) => a.depth - b.depth);  // lower Y = further back = drawn first
```

Entity types dispatched via switch: `counter`, `shelves`, `lottery`, `manager`, `plant`, `floorLamp`, `vending`, `wineRack`, `magazines`, `rug`, `staff`, `cust`.

Scaled rendering via `drawScaled(entity, drawFunction)` (line 1574) applies `sx`/`sy` transforms.

---

## 10. Player Control

The first staff member (`G.staff[0]`) is player-controlled (lines 783-812).

**Movement keys (isometric directions):**

| Key | Direction | dx | dy |
|-----|-----------|----|----|
| Q | NW (up-left) | -spd*0.7 | -spd*0.35 |
| A | SE (down-right) | +spd*0.7 | +spd*0.35 |
| O | SW (down-left) | -spd*0.7 | +spd*0.35 |
| P | NE (up-right) | +spd*0.7 | -spd*0.35 |

- Speed: 1.8 px/frame
- Collision check at feet position (x+7, y+25) via `canWalkTo()`
- Facing direction updates even when blocked
- Walking animation: 2-frame cycle, 6-tick interval
- Visual indicator: pulsing orange `V` arrow above player head (line 2082)

---

## 11. Furniture Types

Each type has a dedicated draw function:

| Type | Function | Line | Size (tiles) | Description |
|------|----------|------|--------------|-------------|
| `counter` | `drawIsoCounter` | 1827 | 1x2, 16px tall | Cash register with mini money display, product samples |
| `shelves` | `drawIsoShelves` | 1846 | 1x2, 55px tall | 4-level shelf with colored products and stock indicators |
| `lottery` | `drawIsoLottery` | 1869 | 2x1, 22px tall | Desk with monitor showing scrolling digits |
| `manager` | `drawIsoManager` | 1885 | 2x1, 20px tall | Desk with laptop (shows year/week), office chair |
| `vending` | `drawIsoVending` | 1978 | 1x1, 44px tall | White machine with product display, brand "XT-3K" |
| `wineRack` | `drawIsoWineRack` | 2010 | 2x1, 48px tall | 4-level wine rack with colored horizontal bottles |
| `magazines` | `drawIsoMagazineRack` | 2046 | 2x1, 40px tall | 3-level rack with colored magazine covers |
| `plant` | `drawIsoPlant` | 1956 | 1x1 | Terracotta pot with animated swaying leaves |
| `floorLamp` | `drawIsoFloorLamp` | 1929 | 1x1 | Tall standing lamp with light glow effect |
| `rug` | `drawIsoRug` | 1995 | 2x2 | Semi-transparent welcome mat overlay on floor |

All furniture uses `drawIsoBlock()` for the 3D base, then adds detail on top.

---

## 12. Wall Elements

Three elements mounted on the left wall (drawn inside `drawShop()`):

### Wall Clock (`drawWallClock`, line 1672)
- Real-time analog clock using system time
- Cached via `_clockH`/`_clockM`, updated every second via `setInterval`
- Positioned at `toIso(0, 3)` minus wall height + 20px offset
- Features: 12 hour markers, hour hand, minute hand, center pin

### LED Banner (`drawLED`, line 1607)
- Scrolling dot-matrix display on left wall
- Scrolls `T().ledMsgs` joined with diamonds, plus live game stats
- Scroll speed: 0.6 px/frame via `ledOffset`
- Scalable via layout editor (`sx` controls length, `sy` controls height)
- Pulsing orange text color

### TFT Screen (`drawTFTScreen`, line 1723)
- 42" digital signage display (Altadis branding)
- 4-slide rotation (300 ticks per slide): Altadis, Xtanco, Admira, live stats
- Positioned below LED banner with 16px gap
- Blue gradient background, screen glare overlay
- Content rotated 180 degrees for left-wall perspective

---

## 13. City Background

### Building generation (line 1191)

14 buildings generated procedurally:

```js
CITY_BUILDINGS.push({
  col: -3 + i*1.3,           // spread across back
  row: -4 - Math.random()*3, // behind shop
  bw: 1 + Math.random()*1.5, // width in tiles
  bd: 0.8 + Math.random(),   // depth in tiles
  h: 40 + Math.random()*120, // pixel height
  hue: 200 + Math.random()*40,
  sat: 15 + Math.random()*20,
  lit: 50 + Math.random()*25,
  winCols: 2 + Math.random()*3,
  winRows: 2 + Math.random()*7,
});
```

Sorted by depth `(col+row)` for back-to-front rendering.

### drawCityBg() (line 1268)

1. Sky gradient (blue normal, red when Elgato light ON)
2. Animated clouds (4 cloud groups scrolling horizontally)
3. Isometric city buildings with animated lit/dark windows
4. Street/sidewalk tiles in front of buildings

### Windows on back wall (line 1364)

4 windows at columns `[1.5, 4, 6.5, 9]` showing miniature city buildings and sky through them, with crossbar frames and window sills.

---

## 14. UI System

### HUD Top Bar (`drawHUD`, line 2126)
- Height: 28px, dark wood color (`#2a1e10`)
- Left: Year/Week label + week progress bar (golden)
- Center-left: Money in golden text
- Center: Rush Hour / Inspection badges (animated)
- Right: Objective progress bar + revenue vs target text

### Bottom Bar (`drawBottomBar`, line 2201)
- Height: 30px, dark wood color
- Sections (left to right): Save button | Year Sales | Year Profit | Satisfaction + Fame bars | Customers + stat bars | Status text | Edit button | Menu button
- All interactive elements registered in `BTNS{}` object

### Overlay Panel (`drawUI`, line 2267)
- Toggled by Menu button or `M` key; `uiOpen` flag
- Position: right side, 170px wide, full height
- Semi-transparent backdrop when open
- Close button (X) top-right
- 4 tabs with 3-letter abbreviations:

| Tab | Index | Function | Contents |
|-----|-------|----------|----------|
| Sales | 0 | `tabSales(py)` | Week revenue/expenses/net, objective bar, 4 stat bars |
| Staff | 1 | `tabStaff(py)` | Staff cards with chibi, stats, hire/train buttons |
| Stock | 2 | `tabStock(py)` | Product cards with stock bars, restock buttons |
| Store | 3 | `tabStore(py)` | 3 ad tiers, store upgrade, salary summary, minimap |

### Button system

All clickable regions registered in `BTNS{}` object:

```js
BTNS[id] = { x, y, w, h };
```

Click handler (line 610) iterates `BTNS`, calls `doAction(id)` on hit.

`mkBtn(id, x, y, w, h, label, color, enabled)` (line 2300) renders and registers a button.

---

## 15. Elgato Key Light Integration

### Configuration (line 47)

```js
const ELGATO = { ip: '192.168.0.109', port: 9123, proxyPort: 9124 };
```

### Flow

1. Press `L` during GAME state
2. `toggleStudioLight()` (line 70) tries 3 URLs in order:
   - `http://localhost:9124/elgato/lights` (proxy)
   - `http://127.0.0.1:9124/elgato/lights` (alt proxy)
   - `http://192.168.0.109:9123/elgato/lights` (direct)
3. GET current state, PUT toggle, play confirmation beep
4. `elgatoState.skyRed` set to match light state
5. Sky gradient changes from blue to red when `skyRed === true`
6. Notification overlay shows status for 120 frames

### Proxy (`elgato-proxy.js`)

Node.js HTTP server on port 9124. Adds CORS headers, forwards requests to Elgato light at `192.168.0.109:9123`. Run with `node elgato-proxy.js`.

---

## 16. Key Constants

### CFG (line 108, overwritten by model on initGame)

```js
const CFG = {
  WEEK_TICKS: 480,           // frames per in-game week
  WEEKS_PER_YEAR: 8,         // weeks per year
  TOTAL_YEARS: 5,            // game duration
  YEAR_TARGETS: [...],       // revenue target per year
  SALE_PROB: 0.055,          // per-staff sale probability per tick
  SALE_BASE: 3.5,            // base sale quantity multiplier
  PRODUCT_AVG_PRICE: 1.6,
  RUSH_CHANCE: 0.0025,       // chance per tick to start rush
  RUSH_DURATION: 160,        // rush duration in ticks
  RUSH_MULT: 2.4,            // sale multiplier during rush
  INSPECT_CHANCE: 0.0006,    // chance per tick for inspection
  HIRE_COST: [...],          // cost to hire each staff slot
  TRAIN_COST: [...],         // cost to train each staff slot
  SALARY: [...],             // weekly salary per role per level
  RESTOCK_COST: 150,
  ADVERT: [{cost, fame, label}, ...],  // 3 tiers
  UPGRADE_COST: 4500,
  START_MONEY: 3500,
  GAMEOVER_THRESHOLD: 0.55,  // below this % of target = game over
};
```

### ISO (line 957)

See section 3.

### P -- Palette (line 124)

All colors organized by category:
- `bg`, `wall`, `floor1`, `floor2` -- environment
- `counter`, `shelf`, `desk`, `lott` -- furniture (with `T` suffix for top face)
- `neon1` (green), `neon2` (red), `neon3` (gold), `neonB` (blue) -- accent colors
- `ui`, `uiB`, `uiH`, `uiT`, `uiT2`, `uiT3` -- UI panel colors
- `skin`, `hair[]`, `shirts[]`, `pants`, `shoes` -- character colors
- `prods[]` -- product colors (6)
- `green`, `red`, `yellow` -- status colors
- `furniture`, `furnitureLight`, `furnitureDark` -- Kairosoft wood tones
- `wallInner`, `wallLight`, `floorWood1`, `floorWood2`, `floorCarpet`

### ELGATO (line 47)

```js
const ELGATO = { ip: '192.168.0.109', port: 9123, proxyPort: 9124 };
```

---

## 17. Input Map

### Keyboard shortcuts

| Key | State | Action |
|-----|-------|--------|
| Arrow Left/Up | MENU | Select Spanish |
| Arrow Right/Down | MENU | Select English |
| Enter/Space | MENU | Confirm language, go to MODEL_SEL |
| Arrows | MODEL_SEL | Navigate 2x2 card grid |
| Enter/Space | MODEL_SEL | Select model, initGame(), go to TUT |
| Escape | MODEL_SEL | Back to MENU |
| Enter/Space/ArrowRight | TUT | Next page (or start game) |
| Q/A/O/P | GAME | Move player (NW/SE/SW/NE) |
| 1/2/3/4 | GAME | Open UI panel to tab 1-4 |
| M | GAME | Toggle UI panel |
| E | GAME | Enter EDITOR mode |
| L | GAME | Toggle Elgato Key Light |
| Escape | GAME | Pause (or close UI if open) |
| Escape | PAUSE | Resume game |
| Enter/Space | YEAR_END | Advance year (after animation) |
| Enter/Space | GAME_END | Return to MENU |
| Arrows | EDITOR | Move selected furniture |
| Shift+Arrows | EDITOR | Resize selected furniture (sx/sy) |
| S | EDITOR | Save layout |
| R | EDITOR | Reset layout to defaults |
| Escape | EDITOR | Deselect item (or exit to GAME) |

### Click handlers

- **MENU**: None (keyboard only)
- **MODEL_SEL**: Click on 2x2 card grid selects model + starts game
- **TUT**: Click anywhere advances page
- **PAUSE**: Click anywhere resumes
- **YEAR_END**: Click when anim > 80 advances year
- **GAME_END**: Click returns to MENU
- **GAME/EDITOR**: Checks `BTNS{}` registry first, then editor tile clicks

### Mouse move

Only active in EDITOR state (line 630): tracks `edHoverTile` for grid highlight.

---

## 18. Game Logic Details

### updateGame() (line 780)

Per-frame update sequence:
1. Player movement (QAOP keys + collision)
2. Rush Hour random trigger + timer
3. Inspection random trigger + pass/fail at timer=100
4. Staff work loop: energy decay, sale probability roll, revenue generation
5. Customer AI: walk/browse/leave state machine with pathfinding
6. Float text animation (drift up + fade)
7. Event message timer countdown
8. Door open timer countdown
9. Week end check (weekTimer >= WEEK_TICKS)

### Sale calculation (line 863)

```
qty = max(1, staffLevel * SALE_BASE * random(0.7-1.3) * productFactor * rushMult)
revenue = qty * productPrice
```

### Week end (`endWeek`, line 743)

1. Pay salaries: `sum(SALARY[role] * level)` for hired staff
2. Stock decay: each product loses 2-6 units randomly
3. Satisfaction decay: -1.5
4. Morale decay: -2 for hired staff
5. Advance week counter; if > WEEKS_PER_YEAR, trigger year end

### Year end rating (`getRating`, line 719)

| Ratio (rev/target) | Rating | Bonus (es) |
|---------------------|--------|------------|
| >= 1.5 | S | +2500 |
| >= 1.2 | A | +1200 |
| >= 1.0 | B | +400 |
| >= 0.8 | C | 0 |
| < 0.8 | D | -600 |

Game over if revenue < target * 0.55.

### Customer AI (lines 876-899)

States: `walk` -> `browse` -> `leave`
- **walk**: Move toward random walkable target tile at speed 1.3; if within 3px, switch to browse
- **browse**: Timer 60-140 ticks; then set leave target to door position
- **leave**: Move toward door at speed 1.6; remove when within 3px of exit
- Door opens (`G.doorOpen = 60`) on spawn and when leaving customer approaches

---

## 19. Chibi Character Renderer

`chibi(x, y, dir, shirt, hair, frame, busy, tick, scale)` (line 1034)

Draws a ~14x27 pixel character:
- Shadow ellipse
- Legs with walk animation (alternating leg extension)
- Shoes
- Torso (colored shirt)
- Arms with busy animation
- Head (skin-colored rectangle)
- Hair (fuller style with side extensions)
- Eyes with periodic blink (every 90 ticks)
- Nose hint

Supports horizontal flip (`dir === -1`) and scaling.

---

## 20. How to Run

### GitHub Pages / static hosting
Simply serve `index.html`. No build step needed.

### Local development
```bash
# Any static server works:
python -m http.server 8000
# or
npx serve .
```

### With Elgato Key Light
```bash
node elgato-proxy.js
# Then open index.html, press L in-game to toggle light
```

The proxy runs on `localhost:9124` and forwards to the Elgato light at `192.168.0.109:9123`.

---

## 21. How to Extend

### Adding new furniture

1. Add entry to `DEFAULT_LAYOUT[]` (line 354) with unique `id` and `type`
2. Add footprint to `FURNITURE_SIZE{}` (line 417)
3. Create `drawIsoNewFurniture(col, row)` function using `drawIsoBlock()` + detail rendering
4. Add case to entity switch in `drawShop()` (line 1588)
5. Add to `drawScaled()` dispatch if it supports scaling

### Adding a new model

1. Add object to `MODELS[]` array (after line 237)
2. Must include all fields: `id`, `neon`, `accent`, `START_MONEY`, `YEAR_TARGETS`, `SALE_PROB`, `SALE_BASE`, `RUSH_CHANCE`, `RUSH_DURATION`, `RUSH_MULT`, `INSPECT_CHANCE`, `HIRE_COST[]`, `TRAIN_COST[]`, `SALARY[]`, `RESTOCK_COST`, `UPGRADE_COST`, `ADVERT[]`, `staffInit[]`, `prodsInit[]`
3. Update MODEL_SEL grid (currently hardcoded 2x2 in `drawModelSelect()` line 1118)
4. Add i18n entries for `modelNames`, `modelDescs`, `modelDiff`, `modelStaff`, `modelProds`, `modelStart` in both `es` and `en`

### Adding new game features

- **New event type**: Add probability check in `updateGame()`, create handler, add i18n strings
- **New UI tab**: Add tab name to `T().tabs`, create `tabNewTab(py)` function, update tab count in `drawUI()`
- **New wall element**: Create draw function, call it from inside `drawShop()` after wall rendering (line 1538)
- **New product**: Add to model's `prodsInit[]`, add label to `T().prodLabel[]`
- **Sound effects**: Use Web Audio API pattern from `playSaveBeep()` (line 2545) or `toggleStudioLight()` (line 91)

### Draw helpers reference

| Helper | Signature | Purpose |
|--------|-----------|---------|
| `r(x,y,w,h,c)` | fillRect | |
| `rx(x,y,w,h,c,lw)` | strokeRect | |
| `tx(s,x,y,c,sz,al)` | fillText | |
| `glow(c,b)` | set shadowColor/shadowBlur | |
| `nog()` | clear shadow | |
| `nl(x1,y1,x2,y2,c,lw)` | neon line (glowing stroke) | |
| `nt(s,x,y,c,sz)` | neon text (glowing, centered) | |

---

## 22. Global Variable Summary

| Variable | Type | Purpose |
|----------|------|---------|
| `cv`, `cx` | Canvas, Context2D | Rendering target |
| `W`, `H` | 800, 500 | Logical canvas size |
| `tt` | number | Global tick counter (incremented every frame) |
| `state` | string | Current game state (from `S` enum) |
| `G` | object | All game runtime data (money, staff, prods, custs, etc.) |
| `CFG` | object | Game balance constants (overwritten per model) |
| `ISO` | object | Isometric grid configuration |
| `P` | object | Color palette |
| `MODELS` | array | 4 shop model configurations |
| `LANGS` | object | i18n strings (es/en) |
| `lang` | 'es'/'en' | Current language |
| `T()` | function | Returns current language strings |
| `shopLayout` | array | Current furniture positions |
| `activeTab` | 0-3 | Selected UI panel tab |
| `uiOpen` | boolean | UI overlay panel visibility |
| `keys` | object | Currently pressed keys |
| `BTNS` | object | Clickable button regions `{id: {x,y,w,h}}` |
| `activeModel` | 0-3 | Selected model index |
| `modelSel` | 0-3 | Model selection cursor |
| `menuSel` | 0-1 | Menu language cursor |
| `tutPage` | 0-2 | Tutorial page index |
| `edSelIdx` | number | Selected furniture index in editor (-1 = none) |
| `edHoverTile` | object | Hovered grid tile in editor |
| `ledOffset` | number | LED banner scroll position |
| `elgatoState` | object | Elgato light state (on, busy, notify, error, skyRed) |
| `mStars` | array | Menu screen star particles (110 items) |
| `CITY_BUILDINGS` | array | Procedurally generated background buildings (14) |
| `SHOP` | object | Shop area rect `{x:0, y:28, w:800, h:442}` |
| `UI` | object | UI panel position `{x:630, w:170}` |
| `edSaveNotify` | number | Editor save notification countdown |
| `monitorAlert` | object | Monitor screen alert `{active, timer, msg, color}` |
| `_clockH`, `_clockM` | number | Cached real clock time (updated every second) |

---

## 23. Counter Pack System

The counter, cash register, and PC monitor are rendered as a **single movable unit** inside `drawIsoCounter(col, row)`.

### Components drawn inside the counter function:
1. **Counter base**: `drawIsoBlock(col,row,1,2,16,...)` — wooden 1x2 block
2. **Cash register** (left side): LCD screen showing `G.money`, buttons, cash drawer
3. **PC monitor** (right side): dark frame, screen, stand, power LED

### Monitor alert system (`monitorAlert`):
- `monitorAlert.active` — boolean, is alert showing
- `monitorAlert.timer` — countdown (300 frames = 5 seconds)
- `monitorAlert.msg` — text shown on screen ("VISITA COMERCIAL", etc.)
- `monitorAlert.color` — screen color during alert
- Timer decremented in `updateGame()`, auto-deactivates at 0
- When inactive, screen shows default blue "XTANCO" with blinking cursor

---

## 24. Visit System (replaces Advertising)

Located in `tabStore(py)` — the LOCAL tab (tab 4).

Four visit action buttons trigger gameplay effects + monitor color changes:

| Visit ID | Label | Monitor Color | Gameplay Effect |
|----------|-------|--------------|-----------------|
| `visitCom` | Visita Comercial | `#22aa44` green | +12 fame, +5 satisfaction |
| `visitTec` | Visita Técnico | `#2266cc` blue | +15 satisfaction, +30% all stock |
| `visitDel` | Visita Delegación | `#cc44aa` pink | +€500-1000 subsidy, +8 fame |
| `visitGC` | Visita Guardia Civil | `#111111` black | Pass: +10 sat / Fail: -€400-1000 fine |

Button colors match their monitor alert color. Each action closes the UI overlay.

---

## 25. Interactive Floor Lamp

`drawIsoFloorLamp(col, row)` renders a clickable lamp with two visual states.

### States:
- **ON** (`elgatoState.on === true`): bright cream shade, yellow floor glow halo (pulsing), vertical light cone, bright bulb (4px) with radiant glow (7px), golden rim
- **OFF** (`elgatoState.on === false`): dark gray shade, no glow, dim bulb (2px), dark rim

### Interaction:
- Registers `BTNS['lampToggle']` covering the full lamp area (28x70px)
- Click triggers `toggleStudioLight()` — same as pressing L
- `toggleStudioLight()` toggles visual state immediately, then tries Elgato API async
- Sound feedback: 660Hz (ON) / 440Hz (OFF)
- Sky turns red when lamp is ON (`elgatoState.skyRed`)

### Elgato connection flow:
1. Toggle `elgatoState.on` immediately (visual)
2. Play sound
3. Try `PUT /elgato/lights` via proxy (non-blocking)
4. If proxy fails, game lamp still works (log message only)

---

## 26. Bird Animation System

Birds fly across the back wall, only visible through window glass.

### Configuration:
- `birdColors[]`: 8 colors cycling per pass (black, red, blue, yellow, green, purple, orange, teal)
- `birdCycleLen`: 700 frames per full crossing
- `birdCycleNum`: determines current bird color (`birdColors[cycleNum % 8]`)

### Rendering:
- Position calculated along back wall (col 0.5 → 10.5)
- Sine wave bobbing for natural flight
- Wing flap animation (3 frames)
- Bird sprite: body ellipse, belly highlight, two wings, tail, head circle, orange beak, white eye with black pupil
- **Clipped to each window rect** — bird disappears behind wall sections between windows

---

*Generated for AI consumption. Line numbers are approximate and may shift with edits.*
