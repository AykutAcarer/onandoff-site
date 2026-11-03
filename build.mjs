#!/usr/bin/env node
// Renders the site from src/ and identity.json into docs/, with no dependencies.
//   node build.mjs             validates identity.json and writes docs/
//   node build.mjs --preview   uses identity.example.json and writes preview/ (git-ignored)
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src');
const EXAMPLE_PATH = join(HERE, 'identity.example.json');

const REQUIRED = ['name', 'street', 'postalCode', 'city', 'countryDe', 'countryEn', 'email'];
const OPTIONAL = ['phone', 'vatId'];
// The other example values are real ones (the country, the support address), which are valid data.
const MUST_DIFFER_FROM_EXAMPLE = ['name', 'street', 'postalCode', 'city'];
const PLACEHOLDER_MARKS = ['YOUR', 'STREET', 'CITY', '{{', '}}'];
const PLAUSIBLE_EMAIL = /^[^\s@<>"']+@[^\s@<>"'.]+(\.[^\s@<>"'.]+)+$/;

// The path 404 pages are served under, from any depth.
const SITE_PATH = '/onandoff-site/';

/** Everything wrong with the identity, as messages. The values themselves are never repeated. */
export function validateIdentity(identity, example) {
  if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) {
    return ['identity.json must be a JSON object.'];
  }
  const problems = [];
  for (const field of [...REQUIRED, ...OPTIONAL]) {
    const value = identity[field];
    const required = REQUIRED.includes(field);
    if (value === undefined || value === null) {
      if (required) problems.push(`"${field}" is missing.`);
      continue;
    }
    if (typeof value !== 'string') {
      problems.push(`"${field}" must be text.`);
      continue;
    }
    if (value.trim() === '') {
      if (required) problems.push(`"${field}" is empty.`);
      continue;
    }
    if (MUST_DIFFER_FROM_EXAMPLE.includes(field) && value.trim() === example[field]) {
      problems.push(`"${field}" still has the value of identity.example.json.`);
    } else if (PLACEHOLDER_MARKS.some((mark) => value.includes(mark))) {
      problems.push(`"${field}" still looks like a placeholder.`);
    }
  }
  const { email } = identity;
  if (typeof email === 'string' && email.trim() !== '' && !PLAUSIBLE_EMAIL.test(email.trim())) {
    problems.push('"email" is not a plausible address.');
  }
  return problems;
}

/** Reads the identity file. Returns the identity, or the problems that stop the build. */
export function loadIdentity(path, example) {
  if (!existsSync(path)) {
    return {
      problems: ['identity.json not found. Copy identity.example.json to it and fill it in.'],
    };
  }
  let identity;
  try {
    identity = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { problems: ['identity.json is not valid JSON.'] };
  }
  const problems = validateIdentity(identity, example);
  return problems.length > 0 ? { problems } : { identity };
}

export function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const readSrc = (path) => readFileSync(join(SRC, path), 'utf8');

/**
 * Keeps a {{#field}}…{{/field}} block only when the field has a value, then fills the placeholders
 * in one pass: identity values are escaped, `trusted` values are the build's own HTML. Whatever is
 * unknown stays, for the check at the end to find.
 */
export function fill(template, identity, trusted = {}) {
  return template
    .replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, field, block) =>
      identity[field] ? block : '',
    )
    .replace(/\{\{(\w+)\}\}/g, (placeholder, name) => {
      if (Object.hasOwn(trusted, name)) return trusted[name];
      if (typeof identity[name] === 'string') return escapeHtml(identity[name]);
      return placeholder;
    });
}

const ROUTES = {
  home: '',
  privacy: 'privacy/',
  terms: 'terms/',
  support: 'support/',
};

const META = {
  home: {
    en: {
      title: 'On & Off',
      description:
        'Rotation calendar for iPhone. Set your rotation once and see every work day and day off, years ahead.',
    },
    tr: {
      title: 'On & Off',
      description:
        'iPhone için vardiya takvimi. Vardiya düzenini bir kez gir, çalışma ve izin günlerini yıllar boyunca gör.',
    },
  },
  privacy: {
    en: {
      title: 'Privacy Policy — On & Off',
      description: 'On & Off collects no personal data. The privacy policy of the iPhone app.',
    },
    tr: {
      title: 'Gizlilik Politikası — On & Off',
      description: 'On & Off hiçbir kişisel veri toplamaz. iPhone uygulamasının gizlilik politikası.',
    },
  },
  terms: {
    en: {
      title: 'Terms of Use — On & Off',
      description: 'The terms of use of the On & Off iPhone app.',
    },
    tr: {
      title: 'Kullanım Şartları — On & Off',
      description: 'On & Off iPhone uygulamasının kullanım şartları.',
    },
  },
  support: {
    en: {
      title: 'Support — On & Off',
      description: 'Contact and quick answers for the On & Off iPhone app.',
    },
    tr: {
      title: 'Destek — On & Off',
      description: 'On & Off iPhone uygulaması için iletişim ve kısa cevaplar.',
    },
  },
};

const IMPRESSUM_ROUTE = 'impressum/';

/** From a route to the site root, so that the site works under any sub-path. */
const rootFor = (route) => {
  const depth = route.split('/').filter(Boolean).length;
  return depth === 0 ? './' : '../'.repeat(depth);
};

const routeFor = (lang, route) => (lang === 'tr' ? `tr/${route}` : route);

function languageSwitch(root, current, enRoute, trRoute) {
  const entry = (lang, label, route) =>
    lang === current
      ? `<span lang="${lang}" aria-current="page">${label}</span>`
      : `<a href="${root}${route}" lang="${lang}" hreflang="${lang}">${label}</a>`;
  return `${entry('en', 'English', enRoute)} / ${entry('tr', 'Türkçe', trRoute)}`;
}

function renderPage({ template, route, lang, uiLang, home, meta, switchTo, alternates }, identity) {
  const root = rootFor(route);
  const alternateLinks = (alternates ?? [])
    .map(([hreflang, target]) => `<link rel="alternate" hreflang="${hreflang}" href="${root}${target}">\n`)
    .join('');
  const layout = readSrc('layout.html')
    .replace('{{header}}', () => readSrc('partials/header.html'))
    .replace('{{footer}}', () => readSrc(`partials/footer.${uiLang}.html`))
    .replace('{{content}}', () => readSrc(`pages/${template}`));
  return fill(layout, identity, {
    root,
    lang,
    uiLang,
    title: escapeHtml(meta.title),
    description: escapeHtml(meta.description),
    alternates: alternateLinks,
    homeHref: `${root}${home}`,
    languageSwitch: languageSwitch(root, switchTo.current, switchTo.en, switchTo.tr),
    switchLabel: uiLang === 'tr' ? 'Dil' : 'Language',
    footerLabel: uiLang === 'tr' ? 'Yasal bilgiler ve destek' : 'Legal and support',
  });
}

/** Every generated file, by its path from the output folder. Throws on a leftover placeholder. */
export function renderSite(identity) {
  const pages = [];
  for (const [page, route] of Object.entries(ROUTES)) {
    const name = page === 'home' ? 'index' : page;
    const alternates = [
      ['en', route],
      ['tr', routeFor('tr', route)],
    ];
    for (const lang of ['en', 'tr']) {
      pages.push({
        template: `${name}.${lang}.html`,
        route: routeFor(lang, route),
        lang,
        uiLang: lang,
        home: routeFor(lang, ''),
        meta: META[page][lang],
        switchTo: { current: lang, en: route, tr: routeFor('tr', route) },
        alternates,
      });
    }
  }
  // German first and then English, so the header and footer are the English ones.
  pages.push({
    template: 'impressum.html',
    route: IMPRESSUM_ROUTE,
    lang: 'de',
    uiLang: 'en',
    home: '',
    meta: {
      title: 'Impressum — On & Off',
      description: 'Impressum und Legal Notice von On & Off, Angaben gemäß § 5 DDG.',
    },
    switchTo: { current: null, en: '', tr: 'tr/' },
  });

  const files = new Map();
  for (const page of pages) {
    files.set(`${page.route}index.html`, renderPage(page, identity));
  }
  files.set(
    '404.html',
    fill(readSrc('pages/404.html'), identity, {
      sitePath: SITE_PATH,
      title: escapeHtml('Page not found — On & Off'),
    }),
  );

  const leftovers = [...files].filter(([, html]) => /\{\{|\}\}/.test(html)).map(([path]) => path);
  if (leftovers.length > 0) {
    throw new Error(`Unfilled placeholders in: ${leftovers.join(', ')}`);
  }

  files.set('styles.css', readSrc('styles.css'));
  files.set('.nojekyll', '');
  return files;
}

function writeSite(files, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  for (const [path, content] of files) {
    const target = join(outDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
}

/** Returns the exit code. Nothing is written or deleted unless all pages rendered. */
export function main(argv, { root = HERE, log = console.log, error = console.error } = {}) {
  const preview = argv.includes('--preview');
  const example = JSON.parse(readFileSync(EXAMPLE_PATH, 'utf8'));

  let identity = example;
  if (!preview) {
    const loaded = loadIdentity(join(root, 'identity.json'), example);
    if (loaded.problems !== undefined) {
      error('Build refused:');
      for (const problem of loaded.problems) error(`  - ${problem}`);
      return 1;
    }
    identity = Object.fromEntries(
      Object.entries(loaded.identity).map(([field, value]) => [
        field,
        typeof value === 'string' ? value.trim() : value,
      ]),
    );
  }

  let files;
  try {
    files = renderSite(identity);
  } catch (caught) {
    error(`Build failed: ${caught.message}`);
    return 1;
  }

  const folder = preview ? 'preview' : 'docs';
  writeSite(files, join(root, folder));
  log(`Generated in ${folder}/:`);
  for (const path of [...files.keys()].sort()) log(`  ${path}`);
  return 0;
}

const isCli =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isCli) process.exit(main(process.argv.slice(2)));
