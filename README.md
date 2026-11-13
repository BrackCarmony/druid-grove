# Druid Grove

A 3D restoration game: you're a wood nymph replanting a shattered planet, one seed at a time,
until hundreds of animal helpers are tending a world of flowers.

Built with Three.js + TypeScript + Vite.

```sh
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run deploy     # build + rsync to the droplet (ssh host "jk")
```

Play it at https://druid-grove.brackcarmony.com.

## Controls

| Input                | Action                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Click                | Capture the mouse (Esc releases)                                                                                  |
| WASD / Shift / Space | Move / run / hop                                                                                                  |
| Hold left mouse      | Plant on the highlighted tiles                                                                                    |
| Scroll               | Zoom: first person → over the shoulder → overview                                                                 |
| 1–3                  | Switch tools                                                                                                      |
| 4–5                  | Ride / dismount a mount                                                                                           |
| B                    | Build menu: then 1–5 for cache, hive, fairy ring, bear den, waystone (H and R still build a hive / ring directly) |
| G                    | List your fairy rings (tiles left, remove for a refund)                                                           |
| T                    | At a waystone: travel to any other waystone                                                                       |
| F                    | Toggle mount auto-planting                                                                                        |
| E                    | Shop                                                                                                              |
| M                    | Toggle sound                                                                                                      |

## How it plays (prototype)

- The land is a **planet**: a 1024×1024 grid of 1m tiles (~1,000 glades) that wraps around in both directions, drawn curving away below the horizon. Walk far enough any way and you come home. Glades are separated by dry creek beds.
- The top box shows the current glade and the **planet's overall restoration** (% of plantable land in bloom, glades restored).
- The **compass** at the top shows your heading, home (⌂ with distance), the nearest waystones (◆) and outlying bear dens (●).
- Soil gets harder the further you go from home: **dirt** nearby, then **clay** (needs the Earthworm Charm), then **stone** (needs Moss Spores) covering the far side of the planet.
- Holding the mouse works the soil. Then the seed sprouts and blooms, and each bloom earns **pollen**.
- Tools: **Tweezers** (one tile) → **Garden Glove** (small patch) → **Rake** (wide swath).
- **Seeds are limited.** Each planted tile uses one seed from your satchel. Refill at the glowing **Seed Hollow** near the start. Bigger Satchel upgrades raise the cap.
- **Squirrel caches** (B menu) are seed stations you place out in the world. Their squirrels run back and forth to the nearest seed hub (the Hollow or a waystone), so a cache far from any hub refills more slowly. The Family, Cheeks and Paws upgrades scale them up.
- **Mounts** (after the rake): the Mossback Tortoise and the Bramble Stag auto-plant a wide circle around themselves and carry their own large seed supply (Saddlebags upgrade). Every mount you own refills at seed spots, ridden or not.
- Nimble Fingers also boosts mounts (+10% per level): a maxed Bramble Stag plants clay at a full gallop; stone still needs a slower pace.
- **Beehives** (H) make honey from the bloomed tiles within 22m. Only one hive per glade, so they spread out across the land. **Bears** walk from their Bear Den to a full hive and carry the honey back. There's a den at home, and more can be built (40m apart), each arriving with a bear. The first bear comes with the first hive; hired bears move into the den with the most hives per bear.
- **Waystones** (from the B menu) are standing-stone arches and your outposts: stand in one and press T to travel to any other, and they're bottomless seed hubs like the Seed Hollow. Squirrels run to the nearest hub (Hollow or waystone), and fairies restock at hubs too. There's one at home.
- **Honey** buys **fairy rings** (R) and fairy upgrades. Each ring's fairies fetch seeds from the nearest Seed Hollow or stocked squirrel cache, then plant the nearest unplanted ground within the ring's reach. **Wayfarer fairies** (honey, expensive) have no ring and no range: they roam the whole planet hunting for bare ground that no ring covers. **G** lists every ring with its tiles left; removing one refunds its honey so it can be rebuilt where there's work.
- Rocks, stumps, heart trees and buildings have collision.
- Bloom 90% of a glade to **restore** it: the rest flourishes outward from the heart, a heart tree grows, the creeks fill with water, and you get bonus pollen plus a permanent pollen multiplier.
- Progress autosaves to localStorage every 10 seconds. The shop has a reset button.

## Code map

| File               | What                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `src/world.ts`     | Map generation (glades, creeks, soil, heights) and per-tile state, uploaded to the GPU as a texture      |
| `src/terrain.ts`   | Camera-following terrain grid (heights from a texture); the seamless shader for barren → tilled → meadow |
| `src/flowers.ts`   | Flowers/grass streamed in chunks around the camera from the bloom state, with a far LOD                  |
| `src/garden.ts`    | Core loop: aiming, planting, growth, bloom, glade completion, save/load                                  |
| `src/economy.ts`   | Tools, soils, upgrades, pollen                                                                           |
| `src/player.ts`    | Movement, the continuous zoom camera, nymph model, first-person tool models                              |
| `src/props.ts`     | Dead stumps and rocks, heart seeds and heart trees                                                       |
| `src/sky.ts`       | Sky dome, shattered moon, debris ring                                                                    |
| `src/fx.ts`        | Pollen particles, procedural chimes                                                                      |
| `src/stations.ts`  | Seed Hollow, squirrel caches, squirrel seed runs                                                         |
| `src/mounts.ts`    | Tortoise / stag models and walk cycle                                                                    |
| `src/colliders.ts` | Circle colliders in a spatial hash                                                                       |
| `src/apiary.ts`    | Beehives, bees, the Bear Den and bear honey runs                                                         |
| `src/planet.ts`    | The planet wrap + curvature applied to every material's vertex shader                                    |
| `src/waystones.ts` | Waystone arches and travel destinations                                                                  |
| `src/fairies.ts`   | Fairy rings and planter fairies (seed fetching, nearest-tile search, instanced rendering)                |

In the browser console, `window.dg` exposes the world, economy, garden and player for debugging.

## Roadmap

1. ~~Prototype: terrain, planting, tools, glades~~
1. ~~Seed logistics (satchel, Seed Hollow, squirrel caches), mounts, collision, bigger world~~
1. ~~Beehives, bears and honey; fairy rings as the first automatic planters~~
1. ~~Planet: wrapping world, waystones, extra bear dens, compass~~
1. More production: wax / royal jelly, mycelium root networks as conveyors
1. More mounts (rain cloud…), and stone-capable mounts
1. Early automation "trap": field mice and ladybugs that need burrow + mycelium hookups
1. Late game: Bloomstriders (big long-legged moss creatures, hundreds of them) flinging pollen pods into hive catchers
1. Animal tenders bouncing around the hives; art, sound, and balance passes

## Performance telemetry

The game profiles every frame (`src/perf.ts`). The main loop marks each chunk of work
(player, garden, fairies, flowers, render, …), and every 30 s the deployed build sends a
small anonymous summary to `/api/perf`: frame-time percentiles, JS time per section, GPU
render time (where the browser supports timer queries), draw calls, device, and game state
such as fairy and bear counts. nginx appends each report to `/var/log/druid-grove/perf.log`
on the droplet, which keeps a year of weekly logs. No IP addresses are stored.

- **F3** in game: live overlay with the same numbers.
- `npm run perf`: pull the reports down to `perf-data/` and print a summary (slowest
  sections, fps by device, how things scale with helpers, progress and zoom).
  `npm run perf:report -- --since 2026-11-13 --build abc1234` re-runs the summary on what
  was already pulled.
- `npm run perf:setup`: (re)install the server side from `deploy/` (idempotent).
- Players can opt out with `?perf=off` (and back in with `?perf=on`). Dev builds don't send.
