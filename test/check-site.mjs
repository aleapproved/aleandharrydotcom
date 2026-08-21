import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './server.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// The safari is unlinked from the nav, but it is still a page of this site
// and answers to every layout invariant the others do.
const PAGES = ['index', 'our-story', 'the-day', 'travel', 'rsvp', 'game', '404'];
const WIDTHS = [1280, 768, 390, 360, 320];

let failures = 0;

function check(name, condition, detail = '') {
  if (condition) return;
  failures++;
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

function section(name) {
  console.log(`\n${name}`);
}

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();

try {
  // ---------------------------------------------------------------
  // Every asset the pages reference actually exists. Catches a typo'd
  // path or an image renamed without updating the markup.
  // ---------------------------------------------------------------
  section('Assets resolve');
  const referenced = new Set();
  for (const page of PAGES) {
    const html = await readFile(new URL(`../${page}.html`, import.meta.url), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) referenced.add(m[1]);
    // srcset lists extra files the src attribute never mentions.
    for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
      for (const candidate of m[1].split(',')) referenced.add(candidate.trim().split(/\s+/)[0]);
    }
  }
  const manifest = JSON.parse(await readFile(new URL('../site.webmanifest', import.meta.url), 'utf8'));
  for (const icon of manifest.icons) referenced.add(icon.src);

  // redirect: manual, because following redirects would let a link written as
  // /travel.html look healthy here while costing every visitor a round trip:
  // the host publishes /travel and 308s the .html form to it.
  for (const asset of [...referenced].sort()) {
    const res = await fetch(base + asset, { redirect: 'manual' });
    check('asset resolves without redirecting', res.status === 200,
      `${asset} returned ${res.status}${res.headers.get('location') ? ` to ${res.headers.get('location')}` : ''}`);
  }
  for (const asset of ['/robots.txt', '/sitemap.xml']) {
    const res = await fetch(base + asset, { redirect: 'manual' });
    check('site metadata resolves', res.status === 200, `${asset} returned ${res.status}`);
  }
  console.log(`  ${referenced.size} references checked`);

  // ---------------------------------------------------------------
  // Layout invariants, across every page, width and colour scheme.
  // ---------------------------------------------------------------
  section('Layout invariants');
  for (const colorScheme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({ colorScheme, viewport: { width, height: 800 } });
      const page = await context.newPage();
      const at = `${colorScheme}/${width}px`;

      const headerHeights = new Set();
      const navTops = new Set();
      const contentWidths = new Set();
      const titlePositions = {};
      const ruleCentres = new Set();

      for (const name of PAGES) {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${base}/${name}.html`);

        const m = await page.evaluate(() => {
          const el = (s) => document.querySelector(s);
          const toggle = el('.theme-toggle').getBoundingClientRect();
          // Only the homepage and the 404 still carry a rule; interior pages
          // open on their title alone.
          const rule = el('.rule')?.getBoundingClientRect();
          const title = el('h1.page-title')?.getBoundingClientRect();
          const root = document.documentElement;
          return {
            headerHeight: +el('.site-header').getBoundingClientRect().height.toFixed(2),
            navTop: +el('.site-header nav a').getBoundingClientRect().top.toFixed(2),
            title: title ? +title.top.toFixed(2) : null,
            hasMark: !!el('.page-mark'),
            ruleCentre: rule ? +(rule.left + rule.width / 2).toFixed(2) : null,
            paper: getComputedStyle(document.body).getPropertyValue('--paper').trim(),
            themeColor: el('meta[name="theme-color"]').content,
            declaredPaper: root.dataset[root.dataset.theme === 'dark' ? 'paperDark' : 'paper'],
            email: el('.site-footer a[href^="mailto:"]')?.getAttribute('href'),
            // body, not documentElement: clientWidth on the root includes the
            // reserved gutter, so it cannot see the width the content gets.
            contentWidth: document.body.clientWidth,
            gutter: getComputedStyle(root).scrollbarGutter,
            toggleW: +toggle.width.toFixed(2),
            toggleH: +toggle.height.toFixed(2),
            scrollsSideways: root.scrollWidth > root.clientWidth,
            position: getComputedStyle(el('.site-header')).position,
          };
        });

        headerHeights.add(m.headerHeight);
        navTops.add(m.navTop);
        contentWidths.add(m.contentWidth);
        if (m.ruleCentre !== null) ruleCentres.add(m.ruleCentre);
        titlePositions[name] = { top: m.title, hasMark: m.hasMark };

        // The browser chrome is painted from <html>'s two papers before the
        // stylesheet loads, so a page whose palette moved on without them
        // flashes the wrong colour behind the address bar.
        check('theme-color matches the page palette', m.themeColor === m.paper,
          `${at}/${name}: chrome ${m.themeColor}, page ${m.paper}`);
        check('theme-color matches what <html> declares', m.themeColor === m.declaredPaper,
          `${at}/${name}: meta ${m.themeColor}, html ${m.declaredPaper}`);
        check('every page offers a way to reach us',
          m.email === 'mailto:rsvp@aleandharry.com', `${at}/${name}: ${m.email}`);

        // Without a reserved gutter, pages that scroll are narrower than
        // pages that don't wherever scrollbars take up space, which pulls
        // their centred content sideways. Headless uses overlay scrollbars
        // and cannot show the shift, so assert the guarantee directly.
        check('scrollbar gutter is reserved', m.gutter === 'stable', `${at}/${name}: ${m.gutter}`);

        check('no page errors', errors.length === 0, `${at}/${name}: ${errors[0]}`);
        // A shrunk toggle stops being a circle — the mobile-overflow tell.
        check('toggle is circular', m.toggleW === m.toggleH, `${at}/${name}: ${m.toggleW}x${m.toggleH}`);
        check('does not scroll sideways', !m.scrollsSideways, `${at}/${name}`);
        check('header is sticky', m.position === 'sticky', `${at}/${name}: ${m.position}`);
      }

      check('header height matches across pages', headerHeights.size === 1, `${at}: ${[...headerHeights].join(', ')}`);
      // The current-page underline must occupy space on every link, or the
      // nav sits a pixel or two higher on the pages that have one.
      check('nav sits on the same line across pages', navTops.size === 1, `${at}: ${[...navTops].join(', ')}`);
      // Interior pages open with an optional mark and then their title, and
      // nothing else. Pages carrying a mark sit lower by exactly the mark's
      // height, so compare like with like: the title must land on the same
      // pixel within each group, or those pages look misaligned against
      // each other when you move between them.
      for (const withMark of [true, false]) {
        const group = ['our-story', 'the-day', 'travel', 'rsvp']
          .filter((n) => titlePositions[n].hasMark === withMark);
        if (group.length < 2) continue;
        const tops = group.map((n) => titlePositions[n].top);
        check(
          `title aligns across interior pages ${withMark ? 'with' : 'without'} a mark`,
          new Set(tops).size === 1,
          `${at}: ${group.map((n, i) => `${n} ${tops[i]}`).join(', ')}`
        );
      }
      check('content width matches across pages', contentWidths.size === 1, `${at}: ${[...contentWidths].join(', ')}`);
      check('rule is centred on the same pixel across pages', ruleCentres.size === 1, `${at}: ${[...ruleCentres].join(', ')}`);

      await context.close();
    }
  }
  console.log(`  ${PAGES.length * WIDTHS.length * 2} page renders checked`);

  // ---------------------------------------------------------------
  // The sticky header keeps its place once the page scrolls.
  // ---------------------------------------------------------------
  section('Sticky header');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 420 } });
    await page.goto(`${base}/our-story.html`);
    await page.evaluate(() => window.scrollTo(0, 300));
    const top = await page.evaluate(() => document.querySelector('.site-header').getBoundingClientRect().top);
    const scrolled = await page.evaluate(() => window.scrollY);
    check('page actually scrolled', scrolled > 100, `scrollY ${scrolled}`);
    check('header pinned to top', top === 0, `top ${top}`);
    await page.close();
  }

  // ---------------------------------------------------------------
  // Photos enlarge on a click. The parts worth pinning down are the ones
  // that are easy to lose: the keyboard route in, the full-size file rather
  // than the phone-sized one, and every way back out.
  // ---------------------------------------------------------------
  section('Lightbox');
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(`${base}/our-story.html`);
    const at = `${width}px`;

    const photos = page.locator('.moment img');
    const count = await photos.count();
    check('every photo is clickable', count > 0
      && (await page.locator('.moment .zoom > img').count()) === count, `${at}: ${count} photos`);

    const widthBefore = await page.evaluate(() => document.body.clientWidth);
    await page.locator('.moment .zoom').first().click();
    const open = await page.evaluate(() => {
      const d = document.querySelector('.lightbox');
      return { open: d.open, src: d.querySelector('.lightbox-image').getAttribute('src') };
    });
    check('clicking a photo opens the lightbox', open.open, at);
    // A -640 or -960 candidate here means the enlarged view is an upscale
    // of the thumbnail the column happened to be served.
    check('lightbox shows the full-size file', /firstdatemap\.png$/.test(open.src), `${at}: ${open.src}`);

    // The page behind must not scroll away under the overlay, and holding it
    // still must not narrow it either, or everything shifts on open.
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(100);
    check('page does not scroll behind the lightbox',
      await page.evaluate(() => window.scrollY) === scrollBefore, at);
    check('locking the page does not change its width',
      await page.evaluate(() => document.body.clientWidth) === widthBefore, at);

    // The photo is shown whole and larger than it was on the page. It must
    // never be cropped or put behind a scrollbar: an earlier version panned
    // around the full-size file, which is not what enlarging a photo means.
    const shown = await page.evaluate(() => {
      const img = document.querySelector('.lightbox-image');
      const box = document.querySelector('.lightbox');
      return {
        w: img.clientWidth,
        h: img.clientHeight,
        ratio: +(img.clientWidth / img.clientHeight).toFixed(3),
        natural: +(img.naturalWidth / img.naturalHeight).toFixed(3),
        overflows: box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight,
        onPage: document.querySelector('.moment img').clientWidth,
      };
    });
    // Rounded to whole pixels, so compare the shape rather than demand it to
    // the third decimal. Cropping would be off by far more than this.
    check('the photo is whole, not cropped', Math.abs(shown.ratio - shown.natural) < 0.01,
      `${at}: shown ${shown.ratio}, actual ${shown.natural}`);
    check('the lightbox never scrolls', !shown.overflows, at);
    // It has to be worth the click. A phone gains least, since the photos
    // already span its column, so it only has to gain: a viewer that hands
    // back the same size it took is the version this replaced.
    check('it is larger than it was on the page', shown.w > shown.onPage * (width > 700 ? 1.25 : 1.05),
      `${at}: ${shown.w} enlarged, ${shown.onPage} on the page`);
    check('the page still shows around the photo', shown.w < width - 8,
      `${at}: ${shown.w} wide in ${width}`);

    // The header is the point of the whole arrangement: the photo grows into
    // the space under it and never covers it.
    const header = await page.evaluate(() => {
      const h = document.querySelector('.site-header').getBoundingClientRect();
      const box = document.querySelector('.lightbox').getBoundingClientRect();
      return { bottom: +h.bottom.toFixed(2), top: +box.top.toFixed(2), visible: h.top === 0 };
    });
    check('the header stays visible above the photo',
      header.visible && header.top >= header.bottom,
      `${at}: header ends at ${header.bottom}, photo area starts at ${header.top}`);

    // A click anywhere is the way out, the photo included: on a phone that is
    // the only thing a thumb reliably lands on.
    await page.locator('.lightbox-image').click();
    check('clicking the photo closes the lightbox',
      await page.evaluate(() => !document.querySelector('.lightbox').open), at);

    await page.locator('.moment .zoom').first().click();
    await page.keyboard.press('Escape');
    check('escape closes the lightbox',
      await page.evaluate(() => !document.querySelector('.lightbox').open), at);
    check('focus returns to the photo that was opened',
      await page.evaluate(() => document.activeElement?.classList.contains('zoom')), at);

    // Keyboard: the wrapper is a real button, so Enter opens it.
    await page.keyboard.press('Enter');
    check('enter opens the lightbox', await page.evaluate(() => document.querySelector('.lightbox').open), at);
    await page.locator('.lightbox-close').click();
    check('the close button closes the lightbox',
      await page.evaluate(() => !document.querySelector('.lightbox').open), at);

    await page.close();
  }

  // ---------------------------------------------------------------
  // A thumb has no cursor to change and no hover to feel, so pressing a photo
  // gives a little before it opens.
  // ---------------------------------------------------------------
  section('Touch');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 }, hasTouch: true });
    await page.goto(`${base}/our-story.html`);

    const bounce = await page.evaluate(() => {
      const touch = [...document.styleSheets[0].cssRules]
        .filter((r) => r.media && r.media.mediaText.includes('hover: none'))
        .flatMap((r) => [...r.cssRules]);
      const press = touch.find((r) => r.selectorText === '.moment img:active');
      const rest = touch.find((r) => r.selectorText === '.moment img');
      return { press: press?.style.transform, eased: rest?.style.transition };
    });
    check('a press scales the photo down', /scale\(0\.97\)/.test(bounce.press || ''),
      `found ${bounce.press}`);
    // Without the overshoot in the curve it is a shrink, not a bounce.
    check('it springs back past its size', /cubic-bezier\(0\.34, 1\.56/.test(bounce.eased || ''),
      `found ${bounce.eased}`);

    // A tap still opens the photo, and the trigger is a real button under it.
    await page.locator('.moment .zoom').first().tap();
    check('tapping a photo opens it',
      await page.evaluate(() => document.querySelector('.lightbox').open));
    await page.locator('.lightbox-image').tap();
    check('tapping it again closes it',
      await page.evaluate(() => !document.querySelector('.lightbox').open));

    await page.close();
  }

  // ---------------------------------------------------------------
  // Cutting a character out of its white artwork by matching colour
  // punches holes wherever the drawing contains a light or a
  // compression-speckled pixel. They are invisible on the cream page and
  // show as a dark rash in dark mode — Bellibolt's pupils looked like
  // they had a border. Anti-aliasing along the silhouette is legitimate,
  // so only count half-transparent pixels well inside the shape.
  // ---------------------------------------------------------------
  section('Cutout quality');
  {
    const page = await browser.newPage();
    await page.goto(`${base}/index.html`);
    for (const file of ['mudkip-badge.png', 'ditto-badge.png', 'bellibolt-badge.png',
                        'chansey-badge.png', 'lapras-badge.png',
                        'solrock-badge.png', 'lunatone-badge.png',
                        'solrock-icon.png', 'lunatone-icon.png']) {
      const holes = await page.evaluate(async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = new OffscreenCanvas(img.width, img.height);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
        const alpha = (x, y) => data[(y * width + x) * 4 + 3];

        let count = 0;
        const R = 3;
        for (let y = R; y < height - R; y++) {
          for (let x = R; x < width - R; x++) {
            const a = alpha(x, y);
            if (a === 0 || a >= 250) continue;
            let nearEdge = false;
            for (let dy = -R; dy <= R && !nearEdge; dy++) {
              for (let dx = -R; dx <= R; dx++) {
                if (alpha(x + dx, y + dy) === 0) { nearEdge = true; break; }
              }
            }
            if (!nearEdge) count++;
          }
        }
        return count;
      }, `/images/${file}`);
      check('cutout has no interior holes', holes < 150, `${file}: ${holes} half-transparent pixels inside the shape`);
    }
    await page.close();
  }

  // ---------------------------------------------------------------
  // Dark mode must look the same however you arrive at it: the OS
  // setting and the toggle used to resolve to different accents.
  // ---------------------------------------------------------------
  section('Theme');
  {
    const accent = (page) =>
      page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--accent').trim());

    const osDark = await browser.newContext({ colorScheme: 'dark' });
    const a = await osDark.newPage();
    await a.goto(`${base}/index.html`);
    const fromOS = await accent(a);
    await osDark.close();

    const osLight = await browser.newContext({ colorScheme: 'light' });
    const b = await osLight.newPage();
    await b.goto(`${base}/index.html`);
    await b.click('#themeToggle');
    const fromToggle = await accent(b);

    check('dark accent is the same via OS and via toggle', fromOS === fromToggle, `${fromOS} vs ${fromToggle}`);
    check('toggle produced dark mode', await b.evaluate(() => document.documentElement.dataset.theme) === 'dark');

    // The choice has to survive navigation, which is what localStorage is for.
    await b.goto(`${base}/our-story.html`);
    check('theme persists across pages', await b.evaluate(() => document.documentElement.dataset.theme) === 'dark');
    await osLight.close();
  }

  // ---------------------------------------------------------------
  // The RSVP confirmation. This lived inside the form, so hiding the
  // form on success hid the thank-you along with it.
  // ---------------------------------------------------------------
  section('RSVP');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    await page.goto(`${base}/rsvp.html`);

    const partyCount = await page.locator('.field-party').count();
    check('guest-only fields exist', partyCount === 3, `found ${partyCount}`);
    check('attendance question is grouped', await page.locator('fieldset legend').textContent() === 'Will you be attending?');
    check('guest-only fields hidden until attending is chosen',
      await page.locator('.field-party').first().isHidden());
    await page.click('label[for="attendingYes"]');
    for (const id of ['partySize', 'guestNames', 'dietary']) {
      check(`${id} shown after choosing yes`, await page.locator('#' + id).isVisible());
    }
    await page.click('label[for="attendingNo"]');
    check('guest-only fields hidden again after choosing no',
      await page.locator('.field-party').first().isHidden());
    check('message stays visible for people who cannot come',
      await page.locator('#message').isVisible());

    // Submitting must be caught here, not at the worker.
    await page.click('.rsvp-submit');
    check('empty name is rejected client-side',
      await page.locator('#rsvpStatus').isVisible());
    check('empty name focuses the field',
      await page.evaluate(() => document.activeElement.id) === 'name');

    await page.fill('#name', 'Test Guest');
    await page.fill('#email', 'not-an-email');
    await page.click('.rsvp-submit');
    check('bad email is rejected client-side',
      (await page.locator('#rsvpStatus').textContent()).includes('email'));
    check('bad email focuses the field',
      await page.evaluate(() => document.activeElement.id) === 'email');

    // Drive the success state directly — the real submit needs the worker.
    await page.evaluate(() => {
      document.getElementById('rsvpForm').classList.add('is-hidden');
      const status = document.getElementById('rsvpStatus');
      status.textContent = 'Thank you.';
      status.dataset.state = 'success';
      status.classList.remove('is-hidden');
    });
    check('confirmation is visible once the form is hidden',
      await page.locator('#rsvpStatus').isVisible());
    await page.close();
  }

  // ---------------------------------------------------------------
  // The safari. It is the one page with rules of its own, so the checks
  // here are the rules: it stays hidden, the two that keep hours keep
  // them, a throw runs all the way through, and a collection survives
  // both a reload and a corrupted save.
  // ---------------------------------------------------------------
  section('Safari');
  {
    // Hidden means it is never named. The way in is the marks: every one of
    // them is a door, so whichever Pokémon a visitor reaches for is the one
    // that works, and a mark left unwrapped is a dead one among live ones.
    for (const name of PAGES) {
      const html = await readFile(new URL(`../${name}.html`, import.meta.url), 'utf8');
      const nav = /<nav>([\s\S]*?)<\/nav>/.exec(html);
      check('the nav never names the safari', !/\/game/.test(nav ? nav[1] : ''), name);

      const marks = [...html.matchAll(/<img class="page-mark"/g)].length;
      const doors = [...html.matchAll(/<a class="mark-link" href="\/game"/g)].length;
      check('every mark is a way in to the safari', marks === doors,
        `${name}: ${marks} marks, ${doors} doors`);
    }
    const gameHtml = await readFile(new URL('../game.html', import.meta.url), 'utf8');
    check('the safari asks not to be indexed', /name="robots" content="noindex"/.test(gameHtml));

    // A link wrapping artwork that is deliberately alt="" has no accessible
    // name of its own, so it has to be given one.
    {
      const page = await browser.newPage();
      for (const name of ['our-story', 'the-day', 'travel', 'rsvp']) {
        await page.goto(`${base}/${name}.html`);
        const named = await page.evaluate(() => [...document.querySelectorAll('.mark-link')]
          .every((a) => (a.getAttribute('aria-label') || '').trim().length > 0));
        check('the way in is announced to a screen reader', named, name);
      }
      await page.close();
    }

    // Six of the seven are only ever named in the script, so the asset check
    // above, which reads the markup, cannot see them.
    const script = await readFile(new URL('../game.js', import.meta.url), 'utf8');
    const roster = [...script.matchAll(/art: '([^']+)'/g)].map((m) => m[1]);
    check('the roster is seven', roster.length === 7, `found ${roster.length}`);
    for (const art of roster) {
      const res = await fetch(base + art, { redirect: 'manual' });
      check('roster artwork resolves', res.status === 200, `${art} returned ${res.status}`);
    }

    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // The page opens on the stage, with no heading anybody can see, so that
    // the Pokédex under it shows above the fold. The heading is still there
    // for the document outline, and it is easy to delete as dead markup by
    // somebody who cannot see it on the page.
    await page.goto(`${base}/game.html`);
    const heading = await page.evaluate(() => {
      const h = document.querySelector('h1');
      if (!h) return null;
      const box = h.getBoundingClientRect();
      return { text: h.textContent.trim(), width: box.width, height: box.height };
    });
    check('the safari still has a heading', heading && heading.text === 'Safari',
      JSON.stringify(heading));
    check('the heading takes up no room on the page',
      heading && heading.width <= 1 && heading.height <= 1, JSON.stringify(heading));

    // The point of dropping it: what is under the stage has to be reachable
    // by eye on an ordinary laptop, or the page reads as ending at the stage.
    for (const height of [800, 720]) {
      const short = await browser.newPage({ viewport: { width: 1280, height } });
      await short.goto(`${base}/game.html`);
      const fold = await short.evaluate(() => ({
        dex: document.querySelector('.dex').getBoundingClientRect().top,
        stage: document.querySelector('.stage').getBoundingClientRect().bottom
      }));
      check('the Pokédex starts above the fold', fold.dex < height,
        `${height}px tall: stage ends at ${Math.round(fold.stage)}, Pokédex starts at ${Math.round(fold.dex)}`);
      await short.close();
    }

    // An encounter is waiting the moment the page settles, with a full set of
    // balls and a line naming what turned up.
    await page.waitForFunction(() => document.getElementById('stage').getAttribute('aria-disabled') === 'false');
    const opening = await page.evaluate(() => ({
      pips: document.querySelectorAll('.pip:not(.is-spent)').length,
      status: document.getElementById('gameStatus').textContent,
      slots: document.querySelectorAll('.dex-slot').length,
      locked: document.querySelectorAll('.dex-slot.is-locked').length
    }));
    check('an encounter is waiting on arrival', /appeared/.test(opening.status), opening.status);
    check('it opens with a full set of balls', opening.pips === 3, `${opening.pips} pips`);
    check('the Pokédex has a place for every species', opening.slots === 7, `${opening.slots} slots`);
    check('a fresh Pokédex is entirely silhouettes', opening.locked === 7, `${opening.locked} locked`);

    // A throw runs the whole way through on its own and hands the stage back,
    // either for the next ball or for the next Pokémon.
    await page.locator('#stage').dispatchEvent('pointerdown', { button: 0 });
    check('the stage is held while the ball is in the air',
      await page.evaluate(() => document.getElementById('stage').getAttribute('aria-disabled')) === 'true');
    await page.waitForFunction(
      () => document.getElementById('stage').getAttribute('aria-disabled') === 'false',
      null, { timeout: 15000 });
    const after = await page.evaluate(() => document.getElementById('gameStatus').textContent);
    check('a throw resolves into a result', /caught|broke free|got away|appeared/.test(after), after);
    check('the throw threw no errors', errors.length === 0, errors[0]);
    await page.close();
  }

  // Solrock and Lunatone are the reason the theme toggle is part of the game,
  // so neither may ever turn up in the other one's half of the day. Each load
  // is one draw; twenty of them in each scheme is enough to catch a pool that
  // was built without looking at the theme.
  {
    for (const [colorScheme, forbidden] of [['light', 'Lunatone'], ['dark', 'Solrock']]) {
      const context = await browser.newContext({ colorScheme, viewport: { width: 390, height: 900 } });
      const page = await context.newPage();
      const seen = new Set();
      for (let i = 0; i < 20; i++) {
        await page.goto(`${base}/game.html`);
        await page.waitForFunction(() => /appeared/.test(document.getElementById('gameStatus').textContent));
        seen.add(await page.evaluate(() => document.querySelector('#gameStatus .said').textContent));
      }
      check(`${forbidden} never appears in ${colorScheme}`, !seen.has(forbidden), [...seen].join(', '));
      check(`${colorScheme} draws more than one species`, seen.size > 1, [...seen].join(', '));
      await context.close();
    }
  }

  // A collection is the only thing this site keeps for anybody, and it keeps
  // it without a login, so the two ways it could be lost both get a check:
  // closing the tab, and a save that has been damaged since it was written.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.goto(`${base}/game.html`);
    await page.evaluate(() => {
      localStorage.setItem('aleandharry:safari:v1', JSON.stringify({
        v: 1, sound: false, total: 12, streak: 2, best: 5,
        species: { mudkip: { caught: 12, shiny: 1, seen: 20, first: 1754400000000 } }
      }));
    });
    await page.reload();
    await page.waitForFunction(() => document.getElementById('statCaught').textContent !== '0');
    const kept = await page.evaluate(() => ({
      caught: document.getElementById('statCaught').textContent,
      species: document.getElementById('statSpecies').textContent,
      best: document.getElementById('statBest').textContent,
      mudkipLocked: document.querySelector('[data-key="mudkip"]').classList.contains('is-locked'),
      shinyRing: document.querySelector('[data-key="mudkip"]').classList.contains('has-shiny'),
      dittoLocked: document.querySelector('[data-key="ditto"]').classList.contains('is-locked')
    }));
    check('a collection survives a reload', kept.caught === '12' && kept.best === '5',
      `${kept.caught} caught, best ${kept.best}`);
    check('the tally counts species, not catches', kept.species === '1/7', kept.species);
    check('a caught entry comes out of silhouette', !kept.mudkipLocked);
    check('an uncaught entry stays in silhouette', kept.dittoLocked);
    check('a shiny is marked on its entry', kept.shinyRing);

    // Anything that is not a save this version wrote is treated as no save at
    // all. A thrown exception here would take the whole page down with it.
    const broken = [];
    page.on('pageerror', (e) => broken.push(e.message));
    for (const junk of ['{', 'null', '[]', '{"v":99}', '{"v":1,"species":null}',
                        '{"v":1,"total":"lots","species":{"mudkip":{"caught":-4}}}']) {
      await page.evaluate((value) => localStorage.setItem('aleandharry:safari:v1', value), junk);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('stage'));
      const reading = await page.evaluate(() => document.getElementById('statCaught').textContent);
      check('a damaged save starts a fresh safari', reading === '0', `${junk} gave ${reading}`);
    }
    check('no damaged save broke the page', broken.length === 0, broken[0]);
    await page.close();
  }

  // ---------------------------------------------------------------
  section('404 handling');
  {
    const res = await fetch(`${base}/no-such-page`);
    check('unknown path serves the 404 page', res.status === 404);
    check('404 page has its own title', (await res.text()).includes('Page not found'));
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
