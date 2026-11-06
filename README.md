# On & Off website

The home page and the legal and support pages of the On & Off iPhone app: home, privacy policy, terms of use, support (English and Turkish) and Impressum (German and English).

Published with GitHub Pages from `main` / `docs`: https://aykutacarer.github.io/onandoff-site/

The pages are static: no JavaScript, no cookies, no analytics and no external requests. Images come only from the site itself. The generator is one Node script with no dependencies (Node 22 or newer).

## Build

1. Copy `identity.example.json` to `identity.json` and fill it in. `identity.json` is git-ignored. `phone` and `vatId` are optional.
2. Run `node build.mjs`. It writes `docs/`, and refuses to build with missing or placeholder data, or with an invalid `site.config.json`.

## Preview

Run `node build.mjs --preview`. It uses the example values and writes `preview/`, which is git-ignored, and never touches `docs/`.

## Test

Run `node --test`.

## App Store badge

`site.config.json` decides what the home pages show under the lead:

- `"appStoreUrl": null` (now, before launch): the line "Coming soon to the App Store" / "Yakında App Store'da".
- An `https://apps.apple.com/…` link: Apple's black "Download on the App Store" badge of each language, linked to it. The badge files are copied unmodified, shown 48 px high with clear space around them. If a language's badge file is missing, that page keeps the line and the build prints a warning.

Any other value of `appStoreUrl` stops the build.

### After launch

1. Download the official black "Download on the App Store" badges, English and Turkish, from Apple's App Store Marketing Tools (toolbox.marketingtools.apple.com), unmodified, as SVG.
2. Save them as `src/img/badges/app-store-en.svg` and `src/img/badges/app-store-tr.svg`.
3. Set `appStoreUrl` in `site.config.json` to the app's App Store link.
4. Run `node build.mjs` (check that it prints no warning), then commit and push.

## Where things are

- `src/layout.html`: the page skeleton
- `src/partials/`: header and footers
- `src/pages/`: one template per page and language
- `src/styles.css`: the styles
- `src/img/`: the app icon (also the favicon and touch icon) and the screenshots of each language, copied to `docs/img/`
- `site.config.json`: the App Store link and the badge files
- `build.mjs`: validation, rendering and the list of pages
