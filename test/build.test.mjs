import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  LEAD,
  SITE_URL,
  badgeWidth,
  escapeHtml,
  fill,
  isAppStoreUrl,
  loadConfig,
  loadIdentity,
  main,
  readImages,
  renderSite,
  validateConfig,
  validateIdentity,
} from '../build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = JSON.parse(readFileSync(join(ROOT, 'identity.example.json'), 'utf8'));

// Made up. The tests never read identity.json of the repo.
const VALID = {
  name: 'Testa Beispiel',
  street: 'Musterweg 1',
  postalCode: '12345',
  city: 'Musterstadt',
  countryDe: 'Deutschland',
  countryEn: 'Germany',
  email: 'app.onandoff@gmail.com',
  phone: '',
  vatId: '',
};

const REQUIRED = ['name', 'street', 'postalCode', 'city', 'countryDe', 'countryEn', 'email'];

const PAGES = [
  'index.html',
  'tr/index.html',
  'privacy/index.html',
  'tr/privacy/index.html',
  'terms/index.html',
  'tr/terms/index.html',
  'support/index.html',
  'tr/support/index.html',
  'impressum/index.html',
];
const EN_LINKS = ['Support', 'Privacy Policy', 'Terms of Use', 'Impressum'];
const TR_LINKS = ['Destek', 'Gizlilik Politikası', 'Kullanım Şartları', 'Künye (Impressum)'];

const IMAGES = [
  'img/app-icon.png',
  'img/badges/app-store-en.svg',
  'img/badges/app-store-tr.svg',
  'img/en/shot-1.png',
  'img/en/shot-2.png',
  'img/en/shot-3.png',
  'img/tr/shot-1.png',
  'img/tr/shot-2.png',
  'img/tr/shot-3.png',
];

const site = renderSite(VALID);
const page = (path, identity = VALID) => renderSite(identity).get(path);

const withTempRoot = (run) => {
  const root = mkdtempSync(join(tmpdir(), 'onandoff-site-'));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const silent = () => {
  const lines = [];
  return { lines, options: { log: (line) => lines.push(line), error: (line) => lines.push(line) } };
};

describe('validateIdentity', () => {
  it('accepts real data, including the country and the support address of the example', () => {
    assert.deepEqual(validateIdentity(VALID, EXAMPLE), []);
  });

  it('accepts umlauts, Turkish letters and lowercase words that are also marks', () => {
    const identity = {
      ...VALID,
      name: 'Gülşen Yıldız İnce',
      street: 'Große Straße 5, Main Street',
      city: 'Bad Füssing City',
    };
    assert.deepEqual(validateIdentity(identity, EXAMPLE), []);
  });

  it('rejects the whole example', () => {
    const problems = validateIdentity(EXAMPLE, EXAMPLE);
    for (const field of ['name', 'street', 'postalCode', 'city']) {
      assert.ok(
        problems.some((problem) => problem.includes(`"${field}"`)),
        field,
      );
    }
  });

  for (const field of REQUIRED) {
    it(`rejects an empty, blank or missing ${field}`, () => {
      for (const value of ['', '   ', null, undefined]) {
        const problems = validateIdentity({ ...VALID, [field]: value }, EXAMPLE);
        assert.ok(problems.some((problem) => problem.includes(`"${field}"`)));
      }
    });
  }

  for (const field of ['name', 'street', 'postalCode', 'city']) {
    it(`rejects the example value of ${field}`, () => {
      const problems = validateIdentity({ ...VALID, [field]: EXAMPLE[field] }, EXAMPLE);
      assert.ok(problems.some((problem) => problem.includes(`"${field}"`)));
    });
  }

  for (const mark of ['YOUR', 'STREET', 'CITY', '{{', '}}']) {
    it(`rejects a value containing ${mark}`, () => {
      for (const field of ['name', 'street', 'phone', 'vatId']) {
        const problems = validateIdentity({ ...VALID, [field]: `A ${mark} B` }, EXAMPLE);
        assert.ok(problems.some((problem) => problem.includes(`"${field}"`)), field);
      }
    });
  }

  for (const email of ['nope', 'a@b', '@b.de', 'a b@c.de', 'a@b.', 'a@.de', 'a@b..de']) {
    it(`rejects the address ${email}`, () => {
      const problems = validateIdentity({ ...VALID, email }, EXAMPLE);
      assert.ok(problems.some((problem) => problem.includes('plausible')));
    });
  }

  it('phone and vatId may be empty or left out', () => {
    const { phone, vatId, ...rest } = VALID;
    assert.deepEqual(validateIdentity(rest, EXAMPLE), []);
  });

  it('rejects a value that is not text, and a file that is no object', () => {
    assert.ok(validateIdentity({ ...VALID, postalCode: 12345 }, EXAMPLE).length > 0);
    assert.ok(validateIdentity([], EXAMPLE).length > 0);
    assert.ok(validateIdentity(null, EXAMPLE).length > 0);
  });

  it('does not repeat the values in its messages', () => {
    const problems = validateIdentity({ ...VALID, name: 'YOUR Testa', email: 'secret' }, EXAMPLE);
    assert.ok(problems.length > 0);
    assert.ok(!problems.join(' ').includes('Testa'));
    assert.ok(!problems.join(' ').includes('secret'));
  });
});

describe('loadIdentity', () => {
  it('says so when the file is missing', () => {
    withTempRoot((root) => {
      const { problems } = loadIdentity(join(root, 'identity.json'), EXAMPLE);
      assert.match(problems[0], /identity\.json not found/);
    });
  });

  it('says so when the file is not JSON', () => {
    withTempRoot((root) => {
      const path = join(root, 'identity.json');
      writeFileSync(path, '{ nope');
      const { problems } = loadIdentity(path, EXAMPLE);
      assert.match(problems[0], /not valid JSON/);
    });
  });
});

describe('main', () => {
  it('refuses without identity.json, exit code 1, and writes nothing', () => {
    withTempRoot((root) => {
      const { lines, options } = silent();
      assert.equal(main([], { root, ...options }), 1);
      assert.match(lines.join('\n'), /identity\.json not found/);
      assert.ok(!existsSync(join(root, 'docs')));
    });
  });

  it('refuses the example data, exit code 1, and leaves an earlier build alone', () => {
    withTempRoot((root) => {
      writeFileSync(join(root, 'identity.json'), JSON.stringify(VALID));
      assert.equal(main([], { root, ...silent().options }), 0);
      const before = readFileSync(join(root, 'docs', 'index.html'), 'utf8');

      writeFileSync(join(root, 'identity.json'), JSON.stringify(EXAMPLE));
      const { lines, options } = silent();
      assert.equal(main([], { root, ...options }), 1);

      assert.match(lines.join('\n'), /Build refused/);
      assert.equal(readFileSync(join(root, 'docs', 'index.html'), 'utf8'), before);
    });
  });

  it('builds docs/ with every file, and lists them', () => {
    withTempRoot((root) => {
      writeFileSync(join(root, 'identity.json'), JSON.stringify(VALID));
      const { lines, options } = silent();

      assert.equal(main([], { root, ...options }), 0);

      for (const path of [...PAGES, ...IMAGES, '404.html', 'styles.css', '.nojekyll']) {
        assert.ok(existsSync(join(root, 'docs', path)), path);
        assert.ok(lines.includes(`  ${path}`), path);
      }
      assert.ok(!existsSync(join(root, 'preview')));
    });
  });

  it('removes what an earlier build left behind', () => {
    withTempRoot((root) => {
      writeFileSync(join(root, 'identity.json'), JSON.stringify(VALID));
      main([], { root, ...silent().options });
      writeFileSync(join(root, 'docs', 'stale.html'), 'old');

      main([], { root, ...silent().options });

      assert.ok(!existsSync(join(root, 'docs', 'stale.html')));
    });
  });

  it('--preview uses the example values, writes preview/ and never docs/', () => {
    withTempRoot((root) => {
      assert.equal(main(['--preview'], { root, ...silent().options }), 0);

      assert.ok(!existsSync(join(root, 'docs')));
      const impressum = readFileSync(join(root, 'preview', 'impressum', 'index.html'), 'utf8');
      assert.ok(impressum.includes('YOUR FULL NAME'));
      assert.ok(impressum.includes('STREET AND NUMBER'));
    });
  });

  it('--preview does not read identity.json', () => {
    withTempRoot((root) => {
      writeFileSync(join(root, 'identity.json'), JSON.stringify(VALID));

      main(['--preview'], { root, ...silent().options });

      const home = readFileSync(join(root, 'preview', 'index.html'), 'utf8');
      assert.ok(!home.includes(VALID.name));
    });
  });

  it('trims the values', () => {
    withTempRoot((root) => {
      writeFileSync(
        join(root, 'identity.json'),
        JSON.stringify({ ...VALID, name: '  Testa Beispiel  ' }),
      );
      main([], { root, ...silent().options });
      const home = readFileSync(join(root, 'docs', 'index.html'), 'utf8');
      assert.ok(home.includes('© 2026 Testa Beispiel</p>'));
    });
  });
});

describe('rendering', () => {
  it('escapes every kind of markup', () => {
    assert.equal(escapeHtml(`<a href="x">Tom & 'Co'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Co&#39;&lt;/a&gt;');
  });

  it('escapes the identity on every page', () => {
    const html = renderSite({ ...VALID, name: 'A <b>B</b> & C', street: 'Weg & Co "1"' });
    for (const path of PAGES) {
      const text = html.get(path);
      assert.ok(text.includes('© 2026 A &lt;b&gt;B&lt;/b&gt; &amp; C'), path);
      assert.ok(!text.includes('<b>B</b>'), path);
    }
    assert.ok(html.get('impressum/index.html').includes('Weg &amp; Co &quot;1&quot;'));
  });

  it('keeps umlauts and Turkish letters as they are', () => {
    const name = 'Jürgen Weiß Öztürk Ağaoğlu Şahin Işık İnan';
    const html = page('impressum/index.html', { ...VALID, name });
    assert.ok(html.includes(name));
    assert.ok(html.includes('<meta charset="utf-8">'));
  });

  it('the Turkish privacy page names the country in Turkish', () => {
    const html = page('tr/privacy/index.html');
    assert.ok(html.includes(`${VALID.city}, Almanya. E-posta:`));
    assert.ok(!html.includes(VALID.countryEn));
  });

  it('a value with a dollar sign stays as it is', () => {
    assert.equal(fill('{{name}}', { name: "$& $1 $'" }), '$&amp; $1 $&#39;');
  });

  it('a value is not filled again', () => {
    assert.equal(fill('{{name}}', { name: '{{email}}', email: 'x' }), '{{email}}');
  });

  it('refuses output with a placeholder left in it', () => {
    assert.throws(() => renderSite({ ...VALID, name: '{{name}}' }), /Unfilled placeholders/);
    assert.throws(() => renderSite({ ...VALID, city: undefined }), /Unfilled placeholders/);
  });

  it('leaves no placeholder in any output', () => {
    for (const [path, content] of site) {
      if (typeof content !== 'string') continue;
      assert.ok(!/\{\{|\}\}/.test(content), path);
    }
  });

  it('the Preview data has none left either', () => {
    for (const [path, content] of renderSite(EXAMPLE)) {
      if (typeof content !== 'string') continue;
      assert.ok(!/\{\{|\}\}/.test(content), path);
    }
  });
});

describe('optional lines', () => {
  const impressum = (values) => page('impressum/index.html', { ...VALID, ...values });

  it('without phone and VAT ID there is no line, no label and no empty line', () => {
    const html = impressum({});
    for (const word of ['Telefon', 'Phone', 'Umsatzsteuer', 'VAT']) {
      assert.ok(!html.includes(word), word);
    }
    assert.ok(!html.includes('<br></p>'));
    assert.ok(!html.includes('<p></p>'));
  });

  it('the phone shows in both languages, and alone', () => {
    const html = impressum({ phone: '+49 000 000' });
    assert.ok(html.includes('Telefon: +49 000 000'));
    assert.ok(html.includes('Phone: +49 000 000'));
    assert.ok(!html.includes('VAT'));
    assert.ok(!html.includes('Umsatzsteuer'));
  });

  it('the VAT ID shows in both languages, and alone', () => {
    const html = impressum({ vatId: 'DE000000000' });
    assert.ok(html.includes('<h2>Umsatzsteuer-ID</h2>'));
    assert.ok(html.includes('gemäß § 27a Umsatzsteuergesetz: DE000000000'));
    assert.ok(html.includes('VAT ID: DE000000000'));
    assert.ok(!html.includes('Telefon'));
    assert.ok(!html.includes('Phone'));
  });

  it('a value left out of the file counts as not set', () => {
    const { phone, vatId, ...rest } = VALID;
    assert.ok(!renderSite(rest).get('impressum/index.html').includes('Telefon'));
  });
});

describe('every page', () => {
  const langOf = (path) => (path.startsWith('tr/') ? 'tr' : path.startsWith('impressum') ? 'de' : 'en');

  for (const path of PAGES) {
    const html = site.get(path);

    it(`${path}: has its language, charset, viewport, title and description`, () => {
      assert.ok(html.startsWith('<!doctype html>'));
      assert.ok(html.includes(`<html lang="${langOf(path)}">`));
      assert.ok(html.includes('<meta charset="utf-8">'));
      assert.ok(html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
      assert.match(html, /<title>[^<]*On &amp; Off<\/title>/);
      assert.match(html, /<meta name="description" content="[^"]+">/);
    });

    it(`${path}: has the footer links and the copyright`, () => {
      const footer = html.slice(html.indexOf('<footer'));
      for (const label of langOf(path) === 'tr' ? TR_LINKS : EN_LINKS) {
        assert.ok(footer.includes(`>${label}</a>`), label);
      }
      assert.ok(footer.includes(`© 2026 ${VALID.name}`));
    });

    it(`${path}: has the home link and the language switch`, () => {
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
      assert.ok(header.includes('>On &amp; Off</a>'));
      assert.ok(header.includes('>English<'));
      assert.ok(header.includes('>Türkçe<'));
    });

    it(`${path}: runs no script, sets no cookie and asks for nothing external`, () => {
      assert.ok(!/<script|<iframe|<object|<embed|<video|<audio|<form|<picture|<source/i.test(html));
      assert.ok(!/\son\w+\s*=/i.test(html));
      assert.ok(!/\ssrcset\s*=/i.test(html));
      // Images only, and only from the site itself.
      for (const [, tag, src] of html.matchAll(/<(\w+)[^>]*\ssrc="([^"]*)"/g)) {
        assert.equal(tag, 'img', src);
        assert.ok(!/^(\w+:|\/)/.test(src), src);
      }
      for (const [, href] of html.matchAll(/<link [^>]*href="([^"]+)"/g)) {
        assert.ok(!/^(https?:)?\/\//.test(href), href);
        assert.ok(!href.startsWith('/'), href);
      }
    });
  }

  it('the 404 page has both texts, and links to both home pages by absolute path', () => {
    const html = site.get('404.html');
    assert.ok(html.includes('Page not found.'));
    assert.ok(html.includes('Sayfa bulunamadı.'));
    assert.ok(html.includes('href="/onandoff-site/"'));
    assert.ok(html.includes('href="/onandoff-site/tr/"'));
    assert.ok(html.includes('href="/onandoff-site/styles.css"'));
    assert.ok(!/<script/i.test(html));
  });

  it('.nojekyll exists and is empty', () => {
    assert.equal(site.get('.nojekyll'), '');
  });
});

describe('hreflang', () => {
  const alternates = (html) =>
    Object.fromEntries(
      [...html.matchAll(/<link rel="alternate" hreflang="(\w+)" href="([^"]+)">/g)].map(
        ([, lang, href]) => [lang, href],
      ),
    );

  for (const [en, tr] of [
    ['index.html', 'tr/index.html'],
    ['privacy/index.html', 'tr/privacy/index.html'],
    ['terms/index.html', 'tr/terms/index.html'],
    ['support/index.html', 'tr/support/index.html'],
  ]) {
    it(`${en} and ${tr} point at each other`, () => {
      const resolve = (from, href) => posix.normalize(posix.join(posix.dirname(from), href, 'index.html'));
      for (const from of [en, tr]) {
        const links = alternates(site.get(from));
        assert.equal(resolve(from, links.en), en);
        assert.equal(resolve(from, links.tr), tr);
      }
    });
  }

  it('the Impressum has no language versions', () => {
    assert.deepEqual(alternates(site.get('impressum/index.html')), {});
  });
});

describe('internal links', () => {
  const targetOf = (from, href) => {
    const clean = href.split('#')[0];
    const path = clean.startsWith('/onandoff-site/')
      ? clean.slice('/onandoff-site/'.length)
      : posix.normalize(posix.join(posix.dirname(from), clean));
    if (path === '.' || path === './' || path === '' || path.endsWith('/')) {
      return `${path === '.' || path === './' ? '' : path}index.html`;
    }
    return path;
  };

  for (const [path, content] of site) {
    if (!path.endsWith('.html')) continue;
    it(`${path}: all resolve to generated files`, () => {
      const hrefs = [...content.matchAll(/\shref="([^"]+)"/g)].map(([, href]) => href);
      assert.ok(hrefs.length > 0);
      for (const href of hrefs) {
        if (/^(https:|mailto:)/.test(href)) continue;
        assert.ok(site.has(targetOf(path, href)), `${href} -> ${targetOf(path, href)}`);
      }
    });
  }

  it('only the 404 page uses absolute paths', () => {
    for (const [path, content] of site) {
      if (!path.endsWith('.html') || path === '404.html') continue;
      assert.ok(!content.includes('href="/'), path);
    }
  });

  it('the language switch keeps the page', () => {
    assert.ok(site.get('privacy/index.html').includes('<a href="../tr/privacy/" lang="tr"'));
    assert.ok(site.get('tr/privacy/index.html').includes('<a href="../../privacy/" lang="en"'));
    assert.ok(site.get('index.html').includes('<a href="./tr/" lang="tr"'));
    assert.ok(site.get('tr/index.html').includes('<a href="../" lang="en"'));
  });

  it('home links stay in the language of the page', () => {
    assert.ok(site.get('privacy/index.html').includes('class="brand" href="../"'));
    assert.ok(site.get('tr/privacy/index.html').includes('class="brand" href="../../tr/"'));
    assert.ok(site.get('impressum/index.html').includes('class="brand" href="../"'));
  });
});

describe('styles', () => {
  const css = site.get('styles.css');
  const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  const light = css.slice(0, css.indexOf('@media'));

  const token = (block, name) => {
    const match = block.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
    assert.ok(match, name);
    return match[1];
  };

  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5]
      .map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const contrast = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };

  it('computes contrast correctly', () => {
    assert.equal(contrast('#000000', '#FFFFFF'), 21);
    assert.equal(contrast('#FFFFFF', '#FFFFFF'), 1);
  });

  for (const [scheme, block] of [
    ['light', light],
    ['dark', dark],
  ]) {
    for (const name of ['text', 'secondary', 'link']) {
      it(`${scheme}: ${name} on the background is at least 4.5:1`, () => {
        const ratio = contrast(token(block, name), token(block, 'background'));
        assert.ok(ratio >= 4.5, `${ratio}`);
      });
    }
  }

  for (const [scheme, block] of [
    ['light', light],
    ['dark', dark],
  ]) {
    for (const name of ['text', 'secondary', 'link']) {
      it(`${scheme}: ${name} on the privacy note is at least 4.5:1`, () => {
        const ratio = contrast(token(block, name), token(block, 'tint'));
        assert.ok(ratio >= 4.5, `${ratio}`);
      });
    }
    for (const name of ['coral', 'green', 'blue']) {
      it(`${scheme}: the ${name} accent stands out from the background at least 3:1`, () => {
        // The accents are the same in dark mode.
        assert.ok(!block.includes(`--${name}:`) || scheme === 'light');
        const ratio = contrast(token(light, name), token(block, 'background'));
        assert.ok(ratio >= 3, `${ratio}`);
      });
    }
  }

  it('white on the accents would be below 4.5:1, so no text is written in or on them', () => {
    for (const name of ['coral', 'green', 'blue']) {
      assert.ok(contrast('#FFFFFF', token(light, name)) < 4.5, name);
    }
    const uses = [...css.matchAll(/([\w-]+):\s*([^;]*var\(--(?:coral|green|blue|accent)\)[^;]*);/g)];
    assert.ok(uses.length >= 5);
    for (const [, property, value] of uses) {
      assert.match(property, /^(border(-\w+)*|--accent)$/, `${property}: ${value}`);
    }
  });

  it('has exactly the colors of the design', () => {
    assert.deepEqual(
      { b: token(light, 'background'), t: token(light, 'text'), s: token(light, 'secondary'), l: token(light, 'link') },
      { b: '#FFFFFF', t: '#1C1C1E', s: '#5B5B60', l: '#2F3A48' },
    );
    assert.deepEqual(
      { b: token(dark, 'background'), t: token(dark, 'text'), s: token(dark, 'secondary'), l: token(dark, 'link') },
      { b: '#000000', t: '#F2F2F7', s: '#A1A1A6', l: '#C9D3DE' },
    );
    assert.deepEqual(
      { coral: token(light, 'coral'), green: token(light, 'green'), blue: token(light, 'blue') },
      { coral: '#E5534B', green: '#2FA874', blue: '#2F86E8' },
    );
    assert.deepEqual(
      { light: token(light, 'tint'), dark: token(dark, 'tint') },
      { light: '#EEF7F2', dark: '#0E1F17' },
    );
    assert.equal(new Set(css.match(/#[0-9A-Fa-f]{3,8}\b/g)).size, 13);
    assert.ok(!/purple|violet|indigo|lavender/i.test(css));
  });

  it('asks for nothing external, and respects the font size of the user', () => {
    assert.ok(!/@import|url\(|@font-face/.test(css));
    assert.ok(!/font-size:\s*[\d.]+px/.test(css));
    assert.ok(!/\b\d+px\b/.test(css));
  });

  it('has the layout of the design, and long addresses cannot overflow', () => {
    assert.ok(css.includes('max-width: 42rem'));
    assert.ok(css.includes('padding: 0 1rem'));
    assert.ok(css.includes('line-height: 1.6'));
    assert.ok(css.includes('overflow-wrap: anywhere'));
    assert.ok(css.includes('text-decoration: underline'));
  });

  it('nothing is wider than a 320 px screen, except inside the row that scrolls on its own', () => {
    assert.match(css, /\nimg \{\n  max-width: 100%;\n  height: auto;\n\}/);
    assert.match(css, /\.shots \{[^}]*overflow-x: auto;[^}]*\}/);
    // The row reaches into the body padding, never past it.
    assert.match(css, /\.shots \{[^}]*margin: 2\.5rem -1rem;[^}]*\}/);
    assert.ok(css.includes('padding: 0 1rem;'));
    assert.ok(css.includes('minmax(min(12rem, 100%), 1fr)'));
    // No fixed widths: the images take theirs from their attributes, and shrink.
    assert.ok(!/(^|[^-])width:\s*[\d.]+(rem|em|vw)/m.test(css));
    for (const path of ['index.html', 'tr/index.html']) {
      for (const [img] of site.get(path).matchAll(/<img [^>]*>/g)) {
        const width = Number(img.match(/ width="(\d+)"/)[1]);
        const scrolls = /img\/(en|tr)\/shot-/.test(img);
        // 288 is 320 less the body padding.
        assert.ok(scrolls || width <= 288, img);
      }
    }
  });

  it('the screenshots scroll with snap points on narrow screens, and sit in 3 columns on wide ones', () => {
    assert.match(css, /\.shots \{[^}]*scroll-snap-type: x mandatory;/);
    assert.match(css, /\.shots li \{[^}]*scroll-snap-align: start;/);
    assert.match(
      css,
      /@media \(min-width: 44rem\) \{\s*\.shots \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
    );
  });

  it('rounds the app icon by 22.5%, and keeps clear space of a quarter badge height', () => {
    assert.match(css, /\.app-icon \{[^}]*border-radius: 22\.5%;/);
    assert.match(css, /\.store-badge \{[^}]*padding: 0\.75rem;/);
  });
});

describe('the repository', () => {
  it('ignores the identity and the preview', () => {
    const ignored = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    for (const entry of ['identity.json', 'preview/', 'node_modules/']) {
      assert.ok(ignored.includes(entry), entry);
    }
  });

  it('has no dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
    assert.deepEqual(Object.keys(pkg.scripts).sort(), ['build', 'preview', 'test']);
  });

  it('the source has no identity written into it', () => {
    const texts = readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8', withFileTypes: false })
      .filter((name) => /\.(html|css)$/.test(name))
      .map((name) => readFileSync(join(ROOT, 'src', name), 'utf8'));
    assert.equal(texts.length, 15);
    for (const text of texts) {
      assert.ok(!text.includes('app.onandoff@gmail.com'));
      assert.ok(!text.includes(VALID.name));
    }
  });
});

const decode = (text) =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');

/** The text of some HTML: no tags, entities decoded, spaces collapsed. */
const textOf = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const elements = (html, tag) =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map(([, inner]) =>
    textOf(inner),
  );

const attributes = (tag) =>
  Object.fromEntries(
    [...tag.matchAll(/\s([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decode(value)]),
  );

const images = (html) => [...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => attributes(tag));

const mainOf = (html) => html.slice(html.indexOf('<main>'), html.indexOf('</main>'));

const HOME = {
  en: {
    path: 'index.html',
    tagline: 'Rotation calendar for iPhone',
    lead: 'Set your rotation once and see every work day and day off for years ahead.',
    availability: 'Coming soon to the App Store',
    iconAlt: 'On & Off app icon',
    features: [
      [
        'Ready-made rotations',
        '24/48, 24/72, 12/24–12/48, 2-2-3, 4/4, 7/7, 14/14 or your own pattern.',
      ],
      [
        'Every day at a glance',
        'Month and year views, single-day changes, notes and a shareable month image.',
      ],
      [
        'On & Off Pro',
        'One-time purchase: Home Screen widget and up to 4 calendars. Family Sharing included.',
      ],
    ],
    shots: ["Month view with today's shift", 'Ready-made rotations', 'Day details with a note'],
    privacy: ['Private by design', 'No account, no ads, no tracking. Your data stays on your iPhone.'],
    privacyLink: ['Privacy Policy', 'privacy/'],
    badgeAlt: 'Download on the App Store',
    locale: 'en_US',
  },
  tr: {
    path: 'tr/index.html',
    tagline: 'iPhone için vardiya takvimi',
    lead: 'Vardiya düzenini bir kez gir, çalışma ve izin günlerini yıllarca gör.',
    availability: "Yakında App Store'da",
    iconAlt: 'On & Off uygulama ikonu',
    features: [
      ['Hazır düzenler', '24/48, 24/72, 12/24–12/48, 2-2-3, 4/4, 7/7, 14/14 ya da kendi düzenin.'],
      [
        'Her gün bir bakışta',
        'Ay ve yıl görünümü, tek gün değişiklikleri, notlar ve paylaşılabilir ay görseli.',
      ],
      [
        'On & Off Pro',
        "Tek seferlik satın alma: ana ekran widget'ı ve 4 takvime kadar. Aile Paylaşımı dahil.",
      ],
    ],
    shots: ['Bugünkü vardiyayla ay görünümü', 'Hazır düzenler', 'Notlu gün detayı'],
    privacy: [
      'Gizlilik önce gelir',
      "Hesap yok, reklam yok, takip yok. Verilerin iPhone'unda kalır.",
    ],
    privacyLink: ['Gizlilik Politikası', 'tr/privacy/'],
    badgeAlt: "App Store'dan indirin",
    locale: 'tr_TR',
  },
};

const APP_STORE_URL = 'https://apps.apple.com/app/on-off/id1234567890';
// The shape of Apple's badge files: a width, a height and a viewBox.
const BADGE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="119.66407" height="40" viewBox="0 0 119.66407 40"><rect width="119.66407" height="40"/></svg>';
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
// The live link of the committed config.
const LIVE_URL = 'https://apps.apple.com/app/id6829474719';
const prelaunch = { ...CONFIG, appStoreUrl: null };
const launched = { ...CONFIG, appStoreUrl: APP_STORE_URL };
// The site before launch: the committed config without the link.
const prelaunchSite = renderSite(VALID, { config: prelaunch });
// The source images with the given badges only, as test files.
const withBadges = (...langs) => {
  const all = readImages();
  for (const lang of LANGS) all.delete(CONFIG.badges[lang]);
  for (const lang of langs) all.set(CONFIG.badges[lang], Buffer.from(BADGE_SVG));
  return all;
};
const LANGS = ['en', 'tr'];
const collect = () => {
  const warnings = [];
  return { warnings, warn: (warning) => warnings.push(warning) };
};

describe('the home pages', () => {
  for (const [lang, text] of Object.entries(HOME)) {
    const html = site.get(text.path);
    const main = mainOf(html);

    it(`${lang}: before launch, the hero has the name, tagline, lead and the availability line`, () => {
      const before = prelaunchSite.get(text.path);
      const beforeMain = mainOf(before);
      assert.deepEqual(elements(beforeMain, 'h1'), ['On & Off']);
      const hero = beforeMain.slice(0, beforeMain.indexOf('</section>'));
      assert.deepEqual(elements(hero, 'p'), [text.tagline, text.lead, text.availability]);
      assert.ok(hero.includes('<p class="availability">'));
      assert.ok(!before.includes('apps.apple.com'));
      assert.ok(!before.includes('img/badges/'));
    });

    it(`${lang}: as committed, the hero has the name, tagline, lead and the linked official badge`, () => {
      assert.deepEqual(elements(main, 'h1'), ['On & Off']);
      const hero = main.slice(0, main.indexOf('</section>'));
      assert.deepEqual(elements(hero, 'p'), [text.tagline, text.lead, '']);
      assert.ok(!hero.includes('class="availability"'));
      const link = hero.match(
        /<p class="store"><a class="store-badge" href="([^"]+)">(<img [^>]+>)<\/a><\/p>/,
      );
      assert.ok(link, lang);
      assert.equal(link[1], LIVE_URL);
      const badge = attributes(link[2]);
      assert.equal(badge.alt, text.badgeAlt);
      assert.ok(Number(badge.height) >= 40, badge.height);
      const target = posix.normalize(posix.join(posix.dirname(text.path), badge.src));
      assert.equal(target, `img/badges/app-store-${lang}.svg`);
      const svg = readFileSync(join(ROOT, 'src', target), 'utf8');
      assert.equal(badge.width, String(badgeWidth(svg)));
    });

    it(`${lang}: the icon is 120 by 120, with its alt text`, () => {
      const [icon] = images(main);
      assert.deepEqual(
        {
          src: posix.normalize(posix.join(posix.dirname(text.path), icon.src)),
          width: icon.width,
          height: icon.height,
          alt: icon.alt,
          class: icon.class,
        },
        { src: 'img/app-icon.png', width: '120', height: '120', alt: text.iconAlt, class: 'app-icon' },
      );
      assert.equal(icon.loading, undefined);
    });

    it(`${lang}: three features, each a heading and one line`, () => {
      const features = [
        ...main.matchAll(/<section class="feature [^"]+">([\s\S]*?)<\/section>/g),
      ].map(([, inner]) => [...elements(inner, 'h2'), ...elements(inner, 'p')]);
      assert.deepEqual(features, text.features);
    });

    it(`${lang}: three screenshots, lazy, 260 wide, with alt texts`, () => {
      const shots = images(main).filter(({ src }) => src.includes('/shot-'));
      assert.deepEqual(
        shots.map(({ alt }) => alt),
        text.shots,
      );
      shots.forEach((shot, index) => {
        assert.equal(
          posix.normalize(posix.join(posix.dirname(text.path), shot.src)),
          `img/${lang}/shot-${index + 1}.png`,
        );
        assert.equal(shot.width, '260');
        assert.equal(shot.height, '564');
        assert.equal(shot.loading, 'lazy');
        assert.equal(shot.decoding, 'async');
      });
      assert.ok(main.includes('<ul class="shots">'));
    });

    it(`${lang}: the privacy note links to the privacy policy`, () => {
      const note = main.slice(main.indexOf('<section class="privacy-note">'));
      assert.deepEqual(elements(note, 'h2'), [text.privacy[0]]);
      assert.deepEqual(elements(note, 'p'), [text.privacy[1], text.privacyLink[0]]);
      const href = note.match(/<a href="([^"]+)">/)[1];
      assert.equal(posix.normalize(posix.join(posix.dirname(text.path), href)), text.privacyLink[1]);
    });

    it(`${lang}: has Open Graph and Twitter tags, with the lead and the first screenshot`, () => {
      const meta = Object.fromEntries(
        [...html.matchAll(/<meta (?:property|name)="((?:og|twitter):[\w:]+)" content="([^"]*)">/g)].map(
          ([, key, value]) => [key, decode(value)],
        ),
      );
      assert.deepEqual(meta, {
        'og:type': 'website',
        'og:title': 'On & Off',
        'og:description': text.lead,
        'og:image': `https://aykutacarer.github.io/onandoff-site/img/${lang}/shot-1.png`,
        'og:locale': text.locale,
        'twitter:card': 'summary_large_image',
      });
      assert.equal(LEAD[lang], text.lead);
      assert.ok(site.has(`img/${lang}/shot-1.png`));
    });

    it(`${lang}: the description is the tagline and the lead`, () => {
      const description = decode(html.match(/<meta name="description" content="([^"]+)">/)[1]);
      assert.equal(description, `${text.tagline}. ${text.lead}`);
    });
  }

  it('the old list of links is gone; the footer keeps them', () => {
    for (const path of ['index.html', 'tr/index.html']) {
      const main = mainOf(site.get(path));
      assert.ok(!main.includes('impressum/'), path);
      assert.ok(!main.includes('support/'), path);
    }
  });

  it('only the home pages have Open Graph tags', () => {
    for (const path of PAGES) {
      if (path === 'index.html' || path === 'tr/index.html') continue;
      assert.ok(!site.get(path).includes('og:'), path);
      assert.ok(!site.get(path).includes('twitter:'), path);
    }
    assert.ok(!site.get('404.html').includes('og:'));
  });

  it('SITE_URL is the published address', () => {
    assert.equal(SITE_URL, 'https://aykutacarer.github.io/onandoff-site/');
  });
});

describe('the App Store badge', () => {
  it('without an App Store link: the availability line, and no warning', () => {
    const { warnings, warn } = collect();
    const html = renderSite(VALID, { config: prelaunch, images: withBadges('en', 'tr'), warn });
    assert.ok(html.get('index.html').includes('<p class="availability">Coming soon to the App Store</p>'));
    assert.ok(html.get('tr/index.html').includes('<p class="availability">Yakında App Store&#39;da</p>'));
    for (const path of ['index.html', 'tr/index.html']) {
      assert.ok(!html.get(path).includes('store-badge'), path);
    }
    assert.deepEqual(warnings, []);
  });

  it('with the link and both badges: the linked badge, 48 high, on both home pages', () => {
    const { warnings, warn } = collect();
    const html = renderSite(VALID, { config: launched, images: withBadges('en', 'tr'), warn });
    for (const [lang, text] of Object.entries(HOME)) {
      const page = html.get(text.path);
      const link = page.match(
        /<p class="store"><a class="store-badge" href="([^"]+)">(<img [^>]+>)<\/a><\/p>/,
      );
      assert.ok(link, lang);
      assert.equal(link[1], APP_STORE_URL);
      const badge = attributes(link[2]);
      assert.equal(badge.alt, text.badgeAlt);
      assert.equal(badge.height, '48');
      assert.equal(badge.width, '144');
      const target = posix.normalize(posix.join(posix.dirname(text.path), badge.src));
      assert.equal(target, CONFIG.badges[lang]);
      assert.ok(html.has(target));
      assert.ok(!page.includes('class="availability"'), lang);
    }
    assert.deepEqual(warnings, []);
  });

  it('copies the badge unmodified', () => {
    const html = renderSite(VALID, { config: launched, images: withBadges('en', 'tr') });
    assert.equal(html.get('img/badges/app-store-en.svg').toString('utf8'), BADGE_SVG);
  });

  it('a missing badge: the availability line for that language only, and a warning', () => {
    const { warnings, warn } = collect();
    const html = renderSite(VALID, { config: launched, images: withBadges('en'), warn });
    assert.ok(html.get('index.html').includes('class="store-badge"'));
    assert.ok(html.get('tr/index.html').includes('<p class="availability">'));
    assert.ok(!html.get('tr/index.html').includes('apps.apple.com'));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /app-store-tr\.svg/);
  });

  it('a badge without a size: the availability line, and a warning', () => {
    const { warnings, warn } = collect();
    const all = withBadges('tr');
    all.set(CONFIG.badges.en, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    const html = renderSite(VALID, { config: launched, images: all, warn });
    assert.ok(html.get('index.html').includes('<p class="availability">'));
    assert.ok(html.get('tr/index.html').includes('class="store-badge"'));
    assert.match(warnings.join(' '), /app-store-en\.svg has no size/);
  });

  it('main prints the warning and still builds', () => {
    withTempRoot((root) => {
      writeFileSync(join(root, 'identity.json'), JSON.stringify(VALID));
      const configPath = join(root, 'site.config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          appStoreUrl: APP_STORE_URL,
          badges: { en: 'img/badges/none-en.svg', tr: 'img/badges/none-tr.svg' },
        }),
      );
      const { lines, options } = silent();
      assert.equal(main([], { root, configPath, ...options }), 0);
      assert.equal(lines.filter((line) => line.startsWith('Warning: No App Store badge')).length, 2);
      assert.ok(readFileSync(join(root, 'docs', 'index.html'), 'utf8').includes('class="availability"'));
    });
  });

  it('the width follows the badge, from width and height or from the viewBox', () => {
    assert.equal(badgeWidth(BADGE_SVG), 144);
    assert.equal(badgeWidth('<svg viewBox="0 0 108.85 40" xmlns="http://www.w3.org/2000/svg">'), 131);
    assert.equal(badgeWidth('<svg width="120px" height="40px">'), 144);
    assert.equal(badgeWidth('<svg stroke-width="2">'), null);
    assert.equal(badgeWidth('not an svg'), null);
  });
});

describe('site.config.json', () => {
  it('as committed: the live App Store link, and the two badge paths', () => {
    assert.deepEqual(CONFIG, {
      appStoreUrl: LIVE_URL,
      badges: { en: 'img/badges/app-store-en.svg', tr: 'img/badges/app-store-tr.svg' },
    });
    assert.deepEqual(loadConfig(join(ROOT, 'site.config.json')), { config: CONFIG });
  });

  it('accepts both states: no link yet (null) and a live link', () => {
    assert.deepEqual(validateConfig(prelaunch), []);
    assert.deepEqual(validateConfig({ ...CONFIG, appStoreUrl: LIVE_URL }), []);
  });

  for (const url of [
    APP_STORE_URL,
    'https://apps.apple.com/tr/app/on-off/id1234567890',
    'https://apps.apple.com/app/id1234567890?l=en',
  ]) {
    it(`accepts ${url}`, () => {
      assert.ok(isAppStoreUrl(url));
      assert.deepEqual(validateConfig({ ...CONFIG, appStoreUrl: url }), []);
    });
  }

  for (const url of [
    '',
    ' ',
    'http://apps.apple.com/app/id1',
    'https://apps.apple.com/',
    'https://apps.apple.com.evil.example/app/id1',
    'https://evil.example/https://apps.apple.com/app/id1',
    'https://user@apps.apple.com/app/id1',
    'https://apps.apple.com:8443/app/id1',
    'https://apps.apple.com/app/id1" onclick="x',
    "https://apps.apple.com/app/id1'><script>",
    'https://apps.apple.com/app/id 1',
    'javascript:alert(1)',
    'apps.apple.com/app/id1',
    42,
    false,
    {},
  ]) {
    it(`refuses the App Store link ${JSON.stringify(url)}`, () => {
      assert.equal(isAppStoreUrl(url), false);
      const problems = validateConfig({ ...CONFIG, appStoreUrl: url });
      assert.ok(problems.some((problem) => problem.includes('appStoreUrl')));
      assert.throws(() => renderSite(VALID, { config: { ...CONFIG, appStoreUrl: url } }), /appStoreUrl/);
    });
  }

  it('refuses a missing link, bad badge paths, unknown settings and a file that is no object', () => {
    const { appStoreUrl, ...noUrl } = CONFIG;
    const has = (config, word) => validateConfig(config).some((problem) => problem.includes(word));
    assert.ok(has(noUrl, 'appStoreUrl'));
    assert.ok(has({ ...CONFIG, badges: { en: '../secret.svg', tr: CONFIG.badges.tr } }, 'badges.en'));
    assert.ok(has({ ...CONFIG, badges: { en: CONFIG.badges.en } }, 'badges.tr'));
    assert.ok(has({ ...CONFIG, badges: null }, 'badges'));
    assert.ok(has({ ...CONFIG, appstoreUrl: APP_STORE_URL }, 'appstoreUrl'));
    assert.deepEqual(validateConfig([]), ['site.config.json must be a JSON object.']);
  });

  it('main refuses a bad config, exit code 1, and writes nothing', () => {
    withTempRoot((root) => {
      writeFileSync(join(root, 'identity.json'), JSON.stringify(VALID));
      const configPath = join(root, 'site.config.json');
      for (const content of [
        '{ nope',
        JSON.stringify({ ...CONFIG, appStoreUrl: 'https://example.com/app' }),
      ]) {
        writeFileSync(configPath, content);
        const { lines, options } = silent();
        assert.equal(main([], { root, configPath, ...options }), 1);
        assert.match(lines.join('\n'), /Build refused/);
        assert.ok(!existsSync(join(root, 'docs')));
      }
    });
  });

  it('main refuses a missing config', () => {
    withTempRoot((root) => {
      writeFileSync(join(root, 'identity.json'), JSON.stringify(VALID));
      const { lines, options } = silent();
      assert.equal(main([], { root, configPath: join(root, 'none.json'), ...options }), 1);
      assert.match(lines.join('\n'), /site\.config\.json not found/);
    });
  });
});

describe('images', () => {
  const htmlFiles = [...site].filter(([path]) => path.endsWith('.html'));
  const resolveFrom = (from, href) =>
    href.startsWith('/onandoff-site/')
      ? href.slice('/onandoff-site/'.length)
      : posix.normalize(posix.join(posix.dirname(from), href));

  it('the source images are in the output, unchanged', () => {
    const source = readImages();
    assert.deepEqual([...source.keys()].sort(), [...IMAGES].sort());
    for (const [path, bytes] of source) {
      assert.ok(Buffer.isBuffer(site.get(path)), path);
      assert.ok(site.get(path).equals(bytes), path);
    }
  });

  it('the icon is 1024 by 1024, the screenshots 520 by 1127 (2x the shown width), all PNG', () => {
    const size = (path) => {
      const bytes = site.get(path);
      assert.equal(bytes.toString('latin1', 1, 4), 'PNG', path);
      return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    };
    assert.deepEqual(size('img/app-icon.png'), [1024, 1024]);
    for (const path of IMAGES.filter((image) => image.includes('shot-'))) {
      assert.deepEqual(size(path), [520, 1127], path);
    }
  });

  it('the width and height of each screenshot keep the proportions of its file', () => {
    for (const path of ['index.html', 'tr/index.html']) {
      for (const shot of images(site.get(path)).filter(({ src }) => src.includes('/shot-'))) {
        const bytes = site.get(posix.normalize(posix.join(posix.dirname(path), shot.src)));
        const [width, height] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
        assert.equal(Number(shot.height), Math.round((Number(shot.width) * height) / width), shot.src);
        // Sharp on 2x screens: the file is at least twice the shown width.
        assert.ok(width >= 2 * Number(shot.width), shot.src);
      }
    }
  });

  for (const [path, html] of htmlFiles) {
    it(`${path}: every referenced image exists in the output`, () => {
      const refs = [
        ...[...html.matchAll(/<img [^>]*src="([^"]+)"/g)].map(([, src]) => src),
        ...[...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]* href="([^"]+)"/g)].map(
          ([, href]) => href,
        ),
      ];
      assert.ok(refs.length >= 2, path);
      for (const ref of refs) {
        assert.ok(site.has(resolveFrom(path, ref)), `${ref} -> ${resolveFrom(path, ref)}`);
      }
    });

    it(`${path}: every image has alt text, width and height`, () => {
      for (const image of images(html)) {
        assert.ok(image.alt !== undefined && image.alt.trim() !== '', image.src);
        assert.match(image.width ?? '', /^\d+$/, image.src);
        assert.match(image.height ?? '', /^\d+$/, image.src);
      }
    });

    it(`${path}: favicon, touch icon and theme colors`, () => {
      assert.match(html, /<link rel="icon" type="image\/png" href="[^"]*img\/app-icon\.png">/);
      assert.match(html, /<link rel="apple-touch-icon" href="[^"]*img\/app-icon\.png">/);
      assert.ok(
        html.includes('<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FFFFFF">'),
      );
      assert.ok(
        html.includes('<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000">'),
      );
    });
  }

  it('the launched badge exists in the output too', () => {
    const launchedSite = renderSite(VALID, { config: launched, images: withBadges('en', 'tr') });
    for (const path of ['index.html', 'tr/index.html']) {
      const html = launchedSite.get(path);
      for (const [, src] of html.matchAll(/<img [^>]*src="([^"]+)"/g)) {
        assert.ok(launchedSite.has(resolveFrom(path, src)), src);
      }
    }
  });
});

describe('external addresses', () => {
  // Links the user may follow from the legal pages. Nothing is loaded from anywhere but the site.
  const LEGAL_LINK_HOSTS = [
    'www.apple.com',
    'reportaproblem.apple.com',
    'docs.github.com',
    'datenschutz.hessen.de',
  ];

  const externalUrls = (html) =>
    [...html.matchAll(/(?:https?:)?\/\/[^\s"'<>)]+/g)].map(([url]) => url);

  const check = (files, allowAppStore) => {
    let count = 0;
    for (const [path, html] of files) {
      if (!path.endsWith('.html')) continue;
      const isHome = path === 'index.html' || path === 'tr/index.html';
      for (const url of externalUrls(html)) {
        count += 1;
        if (isHome && url.startsWith(SITE_URL)) {
          assert.ok(html.includes(`<meta property="og:image" content="${url}">`), `${path}: ${url}`);
          continue;
        }
        const { protocol, hostname } = new URL(url.startsWith('//') ? `https:${url}` : url);
        assert.equal(protocol, 'https:', `${path}: ${url}`);
        // Only as a link to follow.
        assert.ok(html.includes(`href="${url}"`), `${path}: ${url}`);
        if (hostname === 'apps.apple.com') {
          assert.ok(allowAppStore && isHome, `${path}: ${url}`);
          continue;
        }
        assert.ok(!isHome, `${path}: ${url}`);
        assert.ok(LEGAL_LINK_HOSTS.includes(hostname), `${path}: ${url}`);
      }
    }
    return count;
  };

  it('before launch, none on the home pages but the Open Graph image; only the known links on legal pages', () => {
    assert.ok(check(prelaunchSite, false) > 0);
  });

  it('as committed, the live App Store link on the home pages only', () => {
    assert.ok(check(site, true) > 0);
    for (const path of ['index.html', 'tr/index.html']) {
      assert.ok(site.get(path).includes(`href="${LIVE_URL}"`), path);
    }
  });

  it('once launched, the App Store link appears on the home pages only', () => {
    check(renderSite(VALID, { config: launched, images: withBadges('en', 'tr') }), true);
  });

  it('mailto is the only other scheme', () => {
    for (const [path, html] of site) {
      if (!path.endsWith('.html')) continue;
      for (const [, href] of html.matchAll(/\shref="([^"]+)"/g)) {
        const scheme = href.match(/^([a-z][\w+.-]*):/i)?.[1];
        assert.ok(scheme === undefined || scheme === 'https' || scheme === 'mailto', `${path}: ${href}`);
      }
    }
  });
});
