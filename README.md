# On & Off website

The legal and support pages of the On & Off iPhone app: privacy policy, terms of use, support (English and Turkish) and Impressum (German and English).

Published with GitHub Pages from `main` / `docs`: https://aykutacarer.github.io/onandoff-site/

The pages are static: no JavaScript, no cookies, no analytics and no external requests. The generator is one Node script with no dependencies (Node 22 or newer).

## Build

1. Copy `identity.example.json` to `identity.json` and fill it in. `identity.json` is git-ignored. `phone` and `vatId` are optional.
2. Run `node build.mjs`. It writes `docs/`, and refuses to build with missing or placeholder data.

## Preview

Run `node build.mjs --preview`. It uses the example values and writes `preview/`, which is git-ignored, and never touches `docs/`.

## Test

Run `node --test`.

## Where things are

- `src/layout.html`: the page skeleton
- `src/partials/`: header and footers
- `src/pages/`: one template per page and language
- `src/styles.css`: the styles
- `build.mjs`: validation, rendering and the list of pages
