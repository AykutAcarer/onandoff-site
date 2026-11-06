# On & Off — website

Landing page, privacy policy, terms of use, support and legal notice for the On & Off iPhone app.

## Live pages

| Page | URL |
| --- | --- |
| Landing page (English) | https://aykutacarer.github.io/onandoff-site/ |
| Landing page (Turkish) | https://aykutacarer.github.io/onandoff-site/tr/ |
| Privacy policy (English) | https://aykutacarer.github.io/onandoff-site/privacy/ |
| Privacy policy (Turkish) | https://aykutacarer.github.io/onandoff-site/tr/privacy/ |
| Terms of use (English) | https://aykutacarer.github.io/onandoff-site/terms/ |
| Terms of use (Turkish) | https://aykutacarer.github.io/onandoff-site/tr/terms/ |
| Support (English) | https://aykutacarer.github.io/onandoff-site/support/ |
| Support (Turkish) | https://aykutacarer.github.io/onandoff-site/tr/support/ |
| Impressum (German and English, one page) | https://aykutacarer.github.io/onandoff-site/impressum/ |

## How it works

- `src/` is the source: `layout.html`, `partials/` (header and footers), `pages/` (one template per page and language), `styles.css` and `img/`.
- `build.mjs` validates the configuration, renders every page and writes the result to `docs/`. It has no dependencies.
- GitHub Pages serves `docs/` from the `main` branch.
- Do not edit `docs/` by hand: the next build deletes and rewrites it.

## Build

Requires Node 22 or newer. There are no dependencies to install.

```sh
npm run build     # node build.mjs: writes docs/
npm run preview   # node build.mjs --preview: uses identity.example.json, writes preview/ (git-ignored)
npm test          # node --test
```

## Configuration

**`site.config.json`** holds `appStoreUrl` and `badges` (the badge file of each language).

- `"appStoreUrl": null` (before launch): the landing pages show "Coming soon to the App Store".
- An `https://apps.apple.com/…` link: the landing pages show the App Store badge from `src/img/badges/` (path set in `badges`), linked to the app. If a badge file is missing, that page keeps the "Coming soon" line and the build prints a warning.
- Any other value stops the build.

**`identity.json`** holds the publisher details for the legal pages. The build requires it and refuses to run with missing or placeholder values. It is git-ignored and must never be committed. Copy `identity.example.json` and fill in:

```json
{
  "name": "YOUR NAME",
  "street": "YOUR STREET AND NUMBER",
  "postalCode": "YOUR POSTAL CODE",
  "city": "YOUR CITY",
  "countryDe": "YOUR COUNTRY IN GERMAN",
  "countryEn": "YOUR COUNTRY IN ENGLISH",
  "email": "YOUR CONTACT EMAIL",
  "phone": "",
  "vatId": ""
}
```

`phone` and `vatId` are optional; all other keys are required.

## Contact

app.onandoff@gmail.com

## License

Content and code: all rights reserved.
