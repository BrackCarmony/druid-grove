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

| Input | Action |
|---|---|
| Click | Capture the mouse (Esc releases) |
| WASD / Shift / Space | Move / run / hop |
| Hold left mouse | Plant on the highlighted tiles |
| Scroll | Zoom: first person → over the shoulder → overview |
| 1–3 | Switch tools |
| E | Shop |
| M | Toggle sound |

## How it plays (prototype)

- The land is a 160×160 grid of 1m tiles, split into irregular **glades** separated by dry creek beds.
- Soil gets harder toward the edges: **dirt** in the middle, then **clay** (needs the Earthworm Charm), then **stone** (needs Moss Spores).
- Holding the mouse works the soil. Then the seed sprouts and blooms, and each bloom earns **pollen**.
- Tools: **Tweezers** (one tile) → **Garden Glove** (small patch) → **Rake** (wide swath).
- Bloom 90% of a glade to **restore** it: the rest flourishes outward from the heart, a heart tree grows, the creeks fill with water, and you get bonus pollen plus a permanent pollen multiplier.
- Progress autosaves to localStorage every 10 seconds. The shop has a reset button.

## Code map

| File | What |
|---|---|
| `src/world.ts` | Map generation (glades, creeks, soil, heights) and per-tile state, uploaded to the GPU as a texture |
| `src/terrain.ts` | Terrain + outer wasteland meshes; the shader that blends barren → tilled → meadow, plus the tile cursor |
| `src/flowers.ts` | Instanced flowers and grass; grow-in and wind sway run in the vertex shader |
| `src/garden.ts` | Core loop: aiming, planting, growth, bloom, glade completion, save/load |
| `src/economy.ts` | Tools, soils, upgrades, pollen |
| `src/player.ts` | Movement, the continuous zoom camera, nymph model, first-person tool models |
| `src/props.ts` | Dead stumps and rocks, heart seeds and heart trees |
| `src/sky.ts` | Sky dome, shattered moon, debris ring |
| `src/fx.ts` | Pollen particles, procedural chimes |

In the browser console, `window.dg` exposes the world, economy, garden and player for debugging.

## Roadmap

1. ~~Prototype: terrain, planting, tools, glades~~
2. Production branch: beehives → honey / wax / royal jelly, with mycelium root networks as conveyors
3. Mount branch: tortoise (wide tilling), stag (clay), rain cloud
4. Early automation "trap": field mice and ladybugs that need burrow + mycelium hookups
5. Late game: Bloomstriders (big long-legged moss creatures, hundreds of them) flinging pollen pods into hive catchers
6. Animal tenders bouncing around the hives; art, sound, and balance passes
