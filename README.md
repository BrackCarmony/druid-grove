# Druid Grove

A 3D restoration game: you're a wood nymph replanting a shattered world, one seed at a time,
until hundreds of animal helpers are tending a world of flowers.

Built with Three.js + TypeScript + Vite.

```sh
npm install
npm run dev        # http://localhost:5173
npm run typecheck
```

## Controls

| Input                | Action                                            |
| -------------------- | ------------------------------------------------- |
| Click                | Capture the mouse (Esc releases)                  |
| WASD / Shift / Space | Move / run / hop                                  |
| Hold left mouse      | Plant on the highlighted tiles                    |
| Scroll               | Zoom: first person → over the shoulder → overview |
| 1–3                  | Switch tools                                      |
| 4–5                  | Ride / dismount a mount                           |
| B                    | Build a squirrel cache at the cursor              |
| F                    | Toggle mount auto-planting                        |
| E                    | Shop                                              |
| M                    | Toggle sound                                      |

## How it plays (prototype)

- The land is a 384×384 grid of 1m tiles (~144 glades), split into irregular **glades** separated by dry creek beds.
- Soil gets harder toward the edges: **dirt** in the middle, then **clay** (needs the Earthworm Charm), then **stone** (needs Moss Spores).
- Holding the mouse works the soil. Then the seed sprouts and blooms, and each bloom earns **pollen**.
- Tools: **Tweezers** (one tile) → **Garden Glove** (small patch) → **Rake** (wide swath).
- **Seeds are limited.** Each planted tile uses one seed from your satchel. Refill at the glowing **Seed Hollow** near the start. Bigger Satchel upgrades raise the cap.
- **Squirrel caches** (B) are seed stations you place out in the world. Their squirrels run back and forth to the Hollow, so a far-off cache refills more slowly. The Family, Cheeks and Paws upgrades scale them up.
- **Mounts** (after the rake): the Mossback Tortoise and the Bramble Stag auto-plant a wide circle around themselves and carry their own large seed supply (Saddlebags upgrade).
- Rocks, stumps, heart trees and buildings have collision.
- Bloom 90% of a glade to **restore** it: the rest flourishes outward from the heart, a heart tree grows, the creeks fill with water, and you get bonus pollen plus a permanent pollen multiplier.
- Progress autosaves to localStorage every 10 seconds. The shop has a reset button.

## Code map

| File               | What                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/world.ts`     | Map generation (glades, creeks, soil, heights) and per-tile state, uploaded to the GPU as a texture     |
| `src/terrain.ts`   | Terrain + outer wasteland meshes; the shader that blends barren → tilled → meadow, plus the tile cursor |
| `src/flowers.ts`   | Chunked, distance-culled instanced flowers and grass; grow-in and wind sway run in the vertex shader    |
| `src/garden.ts`    | Core loop: aiming, planting, growth, bloom, glade completion, save/load                                 |
| `src/economy.ts`   | Tools, soils, upgrades, pollen                                                                          |
| `src/player.ts`    | Movement, the continuous zoom camera, nymph model, first-person tool models                             |
| `src/props.ts`     | Dead stumps and rocks, heart seeds and heart trees                                                      |
| `src/sky.ts`       | Sky dome, shattered moon, debris ring                                                                   |
| `src/fx.ts`        | Pollen particles, procedural chimes                                                                     |
| `src/stations.ts`  | Seed Hollow, squirrel caches, squirrel seed runs                                                        |
| `src/mounts.ts`    | Tortoise / stag models and walk cycle                                                                   |
| `src/colliders.ts` | Circle colliders in a spatial hash                                                                      |

In the browser console, `window.dg` exposes the world, economy, garden and player for debugging.

## Roadmap

1. ~~Prototype: terrain, planting, tools, glades~~
1. ~~Seed logistics (satchel, Seed Hollow, squirrel caches), mounts, collision, bigger world~~
1. Production branch: beehives → honey / wax / royal jelly, with mycelium root networks as conveyors
1. More mounts (rain cloud…), and stone-capable mounts
1. Early automation "trap": field mice and ladybugs that need burrow + mycelium hookups
1. Late game: Bloomstriders (big long-legged moss creatures, hundreds of them) flinging pollen pods into hive catchers
1. Animal tenders bouncing around the hives; art, sound, and balance passes
