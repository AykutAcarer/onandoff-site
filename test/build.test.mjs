import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { escapeHtml, fill, loadIdentity, main, renderSite, validateIdentity } from '../build.mjs';

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

      for (const path of [...PAGES, '404.html', 'styles.css', '.nojekyll']) {
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
      assert.ok(!/\{\{|\}\}/.test(content), path);
    }
  });

  it('the Preview data has none left either', () => {
    for (const [path, content] of renderSite(EXAMPLE)) {
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
      assert.ok(!/<script|<iframe|<img|<object|<embed|<video|<audio|<form/i.test(html));
      assert.ok(!/\son\w+\s*=/i.test(html));
      assert.ok(!/\ssrc\s*=/i.test(html));
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

  it('has exactly the colors of the design', () => {
    assert.deepEqual(
      { b: token(light, 'background'), t: token(light, 'text'), s: token(light, 'secondary'), l: token(light, 'link') },
      { b: '#FFFFFF', t: '#1C1C1E', s: '#5B5B60', l: '#2F3A48' },
    );
    assert.deepEqual(
      { b: token(dark, 'background'), t: token(dark, 'text'), s: token(dark, 'secondary'), l: token(dark, 'link') },
      { b: '#000000', t: '#F2F2F7', s: '#A1A1A6', l: '#C9D3DE' },
    );
    assert.equal(new Set(css.match(/#[0-9A-Fa-f]{3,8}\b/g)).size, 8);
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
