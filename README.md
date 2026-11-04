# Katamari Amore web port

Work-in-progress browser port (WebGL, plain JS, no build step). Open `index.html` through any static server.

- `menu.html` title, mode and stage select, King briefing
- `game.html?stage=S001&mode=story` the game (`mode`: story, timeattack, eternal; `catch=goal` switches the catch-size rule)
- `viewer.html` model/stage viewer
- `sim.js` rules and physics, `game.js` rendering and HUD, `text.js` / `menu.js` UI, `audio.js` sound
- `tools/` data export scripts (Python), `tests/` bot and smoke tests (Node)
- `ASSUMPTIONS.md` every guess and placeholder, `SPEC.md` notes

Local run: `python3 serve.py` (or `serve.bat`), then open the printed address. Controls: WASD or arrows, Shift or Space to dash, R restart, M mute; touch uses two drag sticks.
