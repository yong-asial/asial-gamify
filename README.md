# Asial World 🎮

A tiny top-down "explorer" web game / PWA. Walk around a small world and discover
[Asial Corporation](https://www.asial.co.jp/) information piece by piece.

Built with **vanilla Canvas** — no build step, no dependencies.

## Controls

- **Move:** Arrow keys / WASD, or **click the ground** to walk there
- **Explore:** walk up to a building and press **E** (or click the building)
- **Read:** `Space` / `→` next page, `←` previous, `Esc` to close

## Run it

`fetch()` needs http (not `file://`), so serve the folder:

```bash
# any one of these, from inside the game/ folder
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>.

## Install as a PWA

Open it over http (or https in production) → your browser's "Install app" /
"Add to Home Screen". The service worker (`sw.js`) caches everything for offline use.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup: canvas, HUD, start screen, info panel |
| `style.css` | All styling |
| `game.js` | Game loop, movement, collisions, camera, panel, PWA registration |
| `content.json` | **The world data** — buildings, positions, and the info pages. Edit this to add/change content. |
| `manifest.json`, `sw.js`, `icon.svg` | PWA layer |

## Add or edit content

Everything you read in-game comes from `content.json`. Each building is a `poi`:

```json
{
  "id": "products",
  "title": "Products (プロダクト)",
  "color": "#a78bfa",
  "icon": "◈",
  "x": 1500, "y": 360, "w": 240, "h": 150,
  "pages": ["First page shown...", "Second page...", "..."]
}
```

- `x, y, w, h` place and size the building in the world (`world.w` × `world.h`).
- `pages` is the list of text shown one at a time — that's the "piece by piece" reveal.
- `spawn` sets where the player starts.

Bump the `CACHE` version in `sw.js` (e.g. `v1` → `v2`) after editing so the PWA picks up changes.
