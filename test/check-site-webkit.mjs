import { webkit } from 'playwright';
import { startServer } from './server.mjs';

const PAGES = ['index', 'our-story', 'the-day', 'travel', 'rsvp', 'game'];

let failures = 0;

function check(name, condition, detail = '') {
  if (condition) return;
  failures++;
  console.log(`  ✗ ${name}${detail ? `: ${detail}` : ''}`);
}

function section(name) {
  console.log(`\n${name}`);
}

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
let browser;

try {
  browser = await webkit.launch();
  section('WebKit page and phone smoke');
  const phone = await browser.newContext({
    colorScheme: 'light',
    viewport: { width: 390, height: 844 },
  });
  const page = await phone.newPage();

  for (const name of PAGES) {
    const errors = [];
    const onPageError = (error) => errors.push(error.message);
    page.on('pageerror', onPageError);
    const response = await page.goto(`${base}/${name}.html`);
    check(`${name} loads in WebKit`, response?.status() === 200, `${response?.status()}`);
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      main: document.querySelector('main')?.getBoundingClientRect().width || 0,
    }));
    check(`${name} has no phone-width horizontal overflow in WebKit`, !layout.overflow);
    check(`${name} has no WebKit page error`, errors.length === 0, errors[0]);
    page.off('pageerror', onPageError);
  }

  section('WebKit navigation and theme');
  await page.goto(`${base}/index.html`);
  await page.locator('nav a[href="/our-story"]').click();
  check('navigation works in WebKit', new URL(page.url()).pathname === '/our-story');

  await page.goto(`${base}/index.html`);
  check('light mode starts unpressed in WebKit',
    await page.getAttribute('#themeToggle', 'aria-pressed') === 'false');
  await page.click('#themeToggle');
  check('theme toggle enters dark mode in WebKit',
    await page.evaluate(() => document.documentElement.dataset.theme === 'dark'));
  check('dark mode is exposed as pressed in WebKit',
    await page.getAttribute('#themeToggle', 'aria-pressed') === 'true');
  await page.click('#themeToggle');
  check('theme toggle returns to light mode in WebKit',
    await page.evaluate(() => document.documentElement.dataset.theme === 'light'));
  check('light mode is exposed as unpressed in WebKit',
    await page.getAttribute('#themeToggle', 'aria-pressed') === 'false');

  section('WebKit RSVP');
  const rsvp = await phone.newPage();
  await rsvp.goto(`${base}/rsvp.html`);
  check('RSVP guest fields start hidden in WebKit', await rsvp.locator('.field-party').first().isHidden());
  await rsvp.click('label[for="attendingYes"]');
  check('RSVP guest fields show for yes in WebKit',
    await rsvp.locator('.field-party').first().isVisible());
  await rsvp.click('label[for="attendingNo"]');
  check('RSVP guest fields hide for no in WebKit',
    await rsvp.locator('.field-party').first().isHidden());
  await rsvp.click('label[for="attendingYes"]');
  await rsvp.click('.rsvp-submit');
  check('empty RSVP name is rejected in WebKit', await rsvp.locator('#rsvpStatus').isVisible());
  check('empty RSVP name receives focus in WebKit', await rsvp.evaluate(() => document.activeElement.id === 'name'));
  await rsvp.fill('#name', 'Test Guest');
  await rsvp.fill('#email', 'not-an-email');
  await rsvp.click('.rsvp-submit');
  check('invalid RSVP email is rejected in WebKit',
    (await rsvp.locator('#rsvpStatus').textContent()).includes('email'));
  check('invalid RSVP email receives focus in WebKit', await rsvp.evaluate(() => document.activeElement.id === 'email'));

  section('WebKit lightbox');
  await page.goto(`${base}/our-story.html`);
  await page.locator('.moment .zoom').first().click();
  const dialog = await page.evaluate(() => {
    const lightbox = document.querySelector('.lightbox');
    return { open: lightbox.open, name: lightbox.getAttribute('aria-label') };
  });
  check('photo lightbox opens in WebKit', dialog.open);
  check('photo lightbox is named in WebKit', dialog.name === 'Enlarged photo', dialog.name);
  await page.keyboard.press('Escape');
  check('photo lightbox closes in WebKit',
    await page.evaluate(() => !document.querySelector('.lightbox').open));

  section('WebKit game');
  const game = await phone.newPage();
  const gameErrors = [];
  game.on('pageerror', (error) => gameErrors.push(error.message));
  await game.goto(`${base}/game.html`);
  await game.waitForFunction(() => document.getElementById('stage').getAttribute('aria-disabled') === 'false');
  check('game reaches an interactive encounter in WebKit',
    await game.evaluate(() => /appeared/.test(document.getElementById('gameStatus').textContent)));
  check('game encounter has no WebKit page error', gameErrors.length === 0, gameErrors[0]);

  await phone.close();

  section('WebKit desktop smoke');
  const desktop = await browser.newContext({
    colorScheme: 'light',
    viewport: { width: 1280, height: 900 },
  });
  const desktopPage = await desktop.newPage();
  for (const name of PAGES) {
    await desktopPage.goto(`${base}/${name}.html`);
    const usable = await desktopPage.evaluate(() => ({
      main: document.querySelector('main')?.getBoundingClientRect().width || 0,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    check(`${name} remains usable at desktop width in WebKit`, usable.main > 0 && !usable.overflow,
      JSON.stringify(usable));
  }
  await desktop.close();
} finally {
  if (browser) await browser.close();
  server.close();
}

console.log(failures === 0 ? '\nAll WebKit smoke checks passed.\n' : `\n${failures} WebKit smoke check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
