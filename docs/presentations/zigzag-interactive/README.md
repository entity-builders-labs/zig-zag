# Zig-Zag — interactive business presentation

Scroll-driven, self-contained browser version of the Zig-Zag business,
product & strategy update (September 2026). The slide copy is in Spanish.
It is documentation, not application code: it has no build step, no
dependencies and no network requests.

## Run

```bash
cd docs/presentations/zigzag-interactive
python3 -m http.server 8000
# open http://localhost:8000
```

## Navigate

- Scroll, or use `↓` / `→` / `PageDown` / `Space` to advance and
  `↑` / `←` / `PageUp` / `Shift+Space` to go back. Scroll-driven scenes have
  intermediate stops, so each key press moves one step of the story.
- `Home` / `End` jump to the first / last scene.
- The dots on the right jump to any of the 19 scenes.

## Motion and accessibility

- `prefers-reduced-motion: reduce` switches to a static layout: every scene
  shows its final state and nothing animates. Append `?motion=reduce` to the
  URL to force this mode.
- Screens narrower than 860px use the same static layout, with stacked grids.
- Fonts come from the system stack (`Inter` if installed locally, otherwise
  the platform UI font). No font files are bundled.

## Structure

```text
index.html        all scenes and copy
assets/styles.css design tokens, scene layouts, static/reduced-motion mode
assets/app.js     scroll progress (--p), data-at reveals, keyboard/dot navigation
```

A sticky scene (`.scene.sticky`) exposes its scroll progress as the CSS
variable `--p` (0 → 1). Elements with `data-at="0.4"` receive `.on` once
progress passes that threshold. Elements with `data-reveal` fade in when they
enter the viewport.

## Content rules

The same rules apply to the companion deck
(`../zigzag-business-update-2026-09-27.pptx` / `.pdf`):

- Each claim is labeled PROBADO (proven), RIESGO OBSERVADO (observed risk),
  PROPUESTO (proposed), FUTURO (future) or HIPÓTESIS DE NEGOCIO (business
  hypothesis).
- There are no invented users, revenue, market size, conversion rates or
  prices. The Trip Pass price is shown only as an unvalidated planning
  assumption.
- The deck is self-explanatory, so it does not reference internal documents,
  test names or error codes.
