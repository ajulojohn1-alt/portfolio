Fixes, minimal-touch (demo.html + styles.css + index.html only):

**1. Broken images (demo.html)**
- Point the 4 concept demo cards at the real files: `img/salon-desktop.png`, `img/solicitor-desktop.png`, `img/accountant-desktop.png`, `img/interiors-desktop.png` (Joel already correctly uses `img/jr-mobile.png`).

**2. Cramped nav (styles.css)**
- Keep the global `.container` at 1200px (homepage layout untouched), but let the nav use a wider shell: `.nav-inner` gets `max-width: min(1440px, calc(100% - 2.5rem)); margin-inline: auto; width: 100%;`. No more two-line "GEO & SEO Checker" on desktop; mobile menu-toggle behaviour unchanged (media queries at styles.css:1390/1426 untouched).

**3. Demo page simplification (demo.html + styles.css)**
- Remove the cover-flow carousel + dot pagination entirely.
- Replace with a simple horizontal row of 5 selectable chips (label + industry, colour-accented, keyboard accessible — reuse the existing click/keydown handlers, just different markup/CSS), plus a one-line instruction above them: "Pick a business to preview its website — use the Desktop / Mobile buttons to switch view."
- Widen the demo viewer: give the viewer section a `.container-wide` class (`max-width: min(1600px, calc(100% - 2rem))`) so the iframe runs near full-width; keep aspect-ratio/scroll behaviour and existing mobile/tablet breakpoints so responsiveness isn't affected.
- Remove now-dead carousel CSS (`folio-*` coverflow rules) and keep the selector-chip styles lean.

**4. Homepage**
- Only change: none required for images (all homepage refs exist on disk). If the homepage screenshots you saw broken were on the live deploy, this is likely the same demo-page issue or stale cache — no code change beyond the above.

Verify with a quick local render (python http.server + browser screenshot) of `/` and `/demo.html` at desktop + narrow widths; then commit + push.