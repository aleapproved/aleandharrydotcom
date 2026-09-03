# aleandharry.com

A static site on Cloudflare Pages, published from `main`. No build step: the
files in the repo root are the site. The deploy stages them into `_site` first
so that the checks, the badge tooling and the worker's source stay in the repo
rather than turning up under aleandharry.com.

## Running it locally

```bash
npm install          # once
npm start            # http://localhost:8000
```

Every asset is referenced from the site root (`/styles.css`, `/images/…`), so
opening the HTML files directly with `file://` renders them unstyled. Use the
server. It mirrors the host, including serving `404.html` for unknown paths.

Two things to know while poking around:

- **The theme toggle sticks.** The choice is kept in `localStorage` and applied
  before first paint, so it overrides your OS setting on every later visit. Run
  `localStorage.removeItem('theme')` in the console to get back to a fresh
  visitor's view.
- **The RSVP form won't submit locally by default.** The worker only accepts
  the production origins until `RSVP_ALLOWED_ORIGINS` is set in its local
  `.dev.vars`. See below for exercising it for real.

## Pages

`index` (names, provisional date, countdown), `our-story`, `the-day`,
`travel`, `rsvp`, `404`, and `game`, which is unlinked. The Day and Travel are
deliberately full of placeholders, since nothing is booked yet, styled with
`.tbc` so every unconfirmed fact hedges in the same voice.

Interior pages open with their mark, then their name as the only heading, and
nothing between that and the content. Every page ends with the same footer
carrying `rsvp@aleandharry.com`, which is the one address guests are given.

The date is **provisional**: Friday, 16 June 2028, nine years to the day from
the first date. It appears on the homepage and The Day, both captioned as
not yet booked.

The homepage countdown ticks every second. Its target lives in one place,
the `data-target` attribute on `#countdown` in `index.html`, currently
`2028-06-16T00:00:00+01:00`. It carries an explicit offset so every guest
counts down to the same instant rather than their own local midnight; edit
that string when there's a start time. Visitors who ask for reduced motion
get a static day count instead of a ticking one.

## Colour

Each page is themed to its Pokémon, in both colour schemes: a pastel paper, a
matching accent, and inks tinted the same way. Hale carries both of us, so it
takes Ditto's lilac as the paper and Mudkip's blue as the accent. Home and the
404 keep the original Solrock cream by day and Lunatone purple by night.

A page names its palette with `data-accent` on `<body>`; `styles.css` defines
each one as a block of `-l` and `-d` pairs, and three small blocks after them
pick between the two. Adding a page means adding one block.

The browser chrome is painted from `meta[name=theme-color]` before the
stylesheet loads, so the two papers are also declared on `<html>` as
`data-paper` and `data-paper-dark`, which is where both the pre-paint script
and `theme-toggle.js` read them from. Change a page's paper and you must change
it in both places; the checks compare them.

**No em dashes**, in prose or in commit messages. A comma, a colon or a full
stop, whichever the sentence actually wants.

## Type

Inter, matching alessandrogillies.com, self-hosted at
`fonts/InterVariable.woff2` and preloaded on every page. It is subset to Latin
and Latin Extended (141KB rather than the full 352KB) with the weight and
optical-size axes intact. Regenerate a subset with:

```bash
python3 -m fontTools.subset InterVariable.woff2 \
  --unicodes="U+0000-00FF,U+0100-017F,U+2000-206F,U+20AC,U+2122,U+2212,U+FEFF,U+FFFD" \
  --layout-features='*' --flavor=woff2 --output-file=fonts/InterVariable.woff2
```

**No italics anywhere.** Colour, weight and size carry those distinctions
instead. Only the upright font ships, so an italic would be synthesised and
look wrong as well as reading poorly.

## Artwork

`tools/make-badge.py` cuts a character out of its original white-background
artwork. Do not cut them by matching colour, which punches holes through the
drawing that only show up in dark mode. Regenerate with:

```bash
python3 tools/make-badge.py images/mudkip-original.jpg images/mudkip-badge.png --height 264
python3 tools/make-badge.py images/solrock.jpg images/solrock-icon.png --canvas 108 108 --content-scale 0.885
```

Solrock and Lunatone have a 264px badge as well as their 108px toggle icon,
because the safari needs all seven at the same size:

```bash
python3 tools/make-badge.py images/solrock.jpg images/solrock-badge.png --height 264
python3 tools/make-badge.py images/lunatone.jpg images/lunatone-badge.png --height 264
```

Artwork that already has an alpha channel is used as-is; only white-background
art gets flooded. The source images in `images/` are inputs to this tool,
so don't delete them.

Photos on Hale ship at three widths (`-640`, `-960`, full) wired through
`srcset`, so a phone doesn't download a desktop-sized file. If you add a photo,
add the variants too: the asset check follows `srcset` and will fail on a
missing candidate. Resize with:

```bash
magick images/photo.jpg -resize 640x -strip -interlace JPEG -quality 82 images/photo-640.jpg
```

`lightbox.js` enlarges any photo inside a `.moment` on a click. The header
stays where it is and stays sharp; the photo grows into the space below it,
over a thin wash of the page's own paper and a light blur, so it reads as the
photo growing rather than as a viewer opening over the top. It is never
cropped and never scrolls. A click anywhere, escape, or the close button puts
it back.

The script wraps each image in a button at load, so the markup stays a plain
`figure` and a visitor without JavaScript still sees every photo at page size.
It measures the header into `--header-h` on open, since the header is two rows
on a phone. A phone gains least from all this, its photos already spanning the
column, so the margin around the enlarged photo narrows to almost nothing
there. Touch also gets a press and a bounce, which needs the empty
`touchstart` listener in the script: iOS will not fire `:active` without one.

Add it to a page with `<script src="/lightbox.js" defer></script>`; it does
nothing on a page with no photos.

## Checks

```bash
npm test
```

Three scripts, run in that order. `test/check-worker.mjs` goes first because it
needs no browser and takes a second: it runs the RSVP worker's own module with
`fetch` stubbed, so nothing it does reaches Airtable and none of it needs a
network. `test/check-site.mjs` then renders every page across five widths in
both colour schemes with Chromium. `test/check-site-webkit.mjs` finishes with
a focused Safari/WebKit smoke pass at phone and desktop widths.

The worker checks are mostly about what it refuses — a party of nought, a party
of a thousand, half a guest, an address that is not one — because that is the
half the browser cannot be trusted with, and about what it stores when it does
accept: the honeypot writing nothing, a "No" bringing no party size, and the
Airtable column names, which are spelled out because renaming one here without
renaming it there loses the answer silently.

The site checks assert the things that are easy to break by accident:

- referenced assets all resolve, and no page throws
- the header is the same height on every page, and the nav sits on the same
  line whether or not the page has the current-page underline
- the title lands on the same pixel across pages of the same shape
- each page's `theme-color` matches both its paper and what `<html>` declares
- every page carries the contact address in its footer
- the theme toggle stays circular, and no page scrolls sideways
- the header stays pinned when the page scrolls
- dark mode resolves to the same accent via the OS setting and via the toggle
- the light Solrock and Bellibolt accents reach WCAG AA contrast, and the
  privacy note remains readable in both schemes
- the theme toggle exposes its current state with `aria-pressed`
- the production security headers authorize every inline script through its
  exact CSP hash
- the RSVP confirmation is visible once the form is hidden on success
- the guest-only fields reveal and hide with the attending choice
- photos enlarge whole, keep the header visible, and close every way out
- badge cutouts have no interior holes
- the safari stays out of the nav and out of search, every page mark is a way
  in to it and every one of those links is named for a screen reader, it keeps
  a heading that costs no pixels, its Pokédex starts above the fold on a short
  laptop, all seven of its sprites resolve, a throw runs all the way through,
  Solrock and Lunatone keep to their own half of the day, and a collection
  survives both a reload and a save that has been damaged since it was written

## Deploying

Pushing to `main` runs `.github/workflows/pages.yml`, which runs the checks
above and then, only if they pass, deploys the RSVP Worker first. The static
Pages site deploy starts only after that Worker deployment succeeds. A pull
request gets the checks and stops there. It needs one repo secret,
`CLOUDFLARE_API_TOKEN`, with Cloudflare Pages edit and Workers Scripts edit
rights; the account ID is in the workflow, since on its own it authorises
nothing.

The deploy stamps a content hash into the URL of both stylesheets and each
script as it stages them, so the pages ask for `/styles.css?v=1a2b3c4d5e`.
Pages revalidate on every load but assets are cached for four hours, and
without this a deploy that changed both left visitors running new markup
against old CSS for the rest of the afternoon. It cost an afternoon once:
photos wrapped in buttons the cached stylesheet knew nothing about rendered
as grey boxes. The files keep their plain names in the repo, so nothing about
working locally changes, and the deploy fails if a page slips through still
asking for an unstamped name.

The deploy stays here rather than moving to Cloudflare Pages' own Git
integration, which would publish the moment you push and cannot be made to
wait for a check. Gating it there would mean running the checks in the Pages
build container, which has no root and so cannot install Chromium's system
dependencies.

The staging step removes the original artwork used to make the badges. Those
files remain in the repository for regeneration, but are not guest-facing site
assets.

DNS for aleandharry.com is on Cloudflare. The apex and `www` resolve to the
Pages project; the Fastmail `MX` records are untouched by any of this and must
stay that way. If a deploy ever needs backing out in a hurry, the site is
static and every previous deployment stays addressable in the Pages dashboard,
so rolling back is a promotion rather than a revert.

## The safari

`/game` is unlisted: the nav never names it and it carries `noindex`. The way
in is the marks. Every `.page-mark` on the site is wrapped in a link to it, so
whichever Pokémon a visitor reaches for is the one that opens the door, and a
mark left unwrapped would be a dead one among live ones. The checks assert all
of that, and that the link leaves the mark on exactly the pixel it was on.

Because the artwork is deliberately `alt=""`, each link carries its own
`aria-label` ("Catch a Chansey"). A screen reader gets told where it goes
rather than being handed a mystery.

It is a small Pokémon catching game, and it is the only part of the site with
rules.

The whole of it is `game.html`, `game.css` and `game.js`. None of the three is
loaded anywhere else and `styles.css` knows nothing about them, so the game can
be as elaborate as it likes without a line of it reaching the other pages. It
borrows the site's paper, ink and accent and takes the default palette, which
is Solrock cream by day and Lunatone purple by night.

**The page opens on the stage.** There is no visible heading and no standfirst
above it, because with them there the Pokédex sat below the fold on an ordinary
laptop and the page read as ending at the stage. The `<h1>` is still in the
markup, visually hidden, so the document has a name for a screen reader; the
checks assert it is there, that it takes up no room, and that the Pokédex
starts above the fold at 800px and 720px tall. It is the kind of markup
somebody deletes as dead, so it is worth a check.

The one sentence that standfirst was carrying, how to play, moved into the
status line under the stage. It is appended to the first encounter a visitor
with an empty save sees and never shown again.

**The mechanic.** A ring falls inwards around a Pokémon and the throw is
scored on how close it was to the fixed circle when the ball left your hand:
Perfect doubles the odds, Wide two-thirds them. Three balls an encounter, and
the Pokémon stays until they are gone. Nothing is timed and nothing can be
lost by waiting, which is the right amount of pressure for a wedding website.

**The seven** are the site's own Pokémon, one per page, which is why there are
seven and not a hundred and fifty. Each has a spawn weight, a base catch rate
and a ring speed, so the rare ones are also the harder throws. Solrock and
Lunatone are `only: 'day'` and `only: 'night'` and are drawn from the theme,
which makes the header's toggle part of the game: you cannot finish the
Pokédex without using it. The clue is in each one's entry.

Shinies are one in forty and are the same drawing under a per-species
`hue-rotate`, tuned so each is unmistakable against its ordinary colours. A
shiny in the collection puts a second ring on that entry; the entry itself
keeps the ordinary artwork, since a recoloured one in the middle of the row
just looks wrong.

**Progress** lives in `localStorage` under `aleandharry:safari:v1`, so a
collection survives closing the tab and nobody is ever asked who they are.
It is read back field by field rather than trusted, because the one thing that
must not happen is a save edited in the console taking the page down. A
browser that refuses to store anything still plays and says so.

Run `localStorage.removeItem('aleandharry:safari:v1')` to get back to a first
visit, or use the page's own **Release them all**, which asks twice.

**Sound** is synthesised with the Web Audio API rather than shipped as files,
so it costs nothing to download. It is off until the speaker on the stage is
pressed, and that choice is kept: a website that starts making noise at you
has lost the argument. The preference survives **Release them all**, since it
is a setting rather than progress.

**Motion.** Reduced motion keeps the ring, which is the game, but slows it by
a little over half and drops the idle bob, the shiny's glint and the burst on
a catch. The pauses that exist so a line can be read are left at full length;
only the ones waiting on a movement are shortened.

## The RSVP worker

`worker/` holds a Cloudflare Worker that validates a submission and upserts it
to Airtable. It writes `Name`, `Email`, `Attending`, `Party Size`,
`Guest Names`, `Dietary Requirements` and `Message`. Airtable rejects the
whole record if a field doesn't exist, so add the column before sending a new
one. Emails are trimmed and lower-cased before storage, and Airtable's native
upsert merges on the existing `Email` field so a guest has one row.

Free text is capped rather than refused, so nobody loses an essay to an error
message: 200 characters for a name, 2000 for guest names and a message, 1000
for a dietary note. The address is the exception and is refused if it is over
200, because cutting an address to length can leave one that still looks like
an address — `guest@sub.sub…example.com` trimmed at 200 ends `…sub.ex`, which
passes the check and gets stored as somewhere nobody lives, under a guest who
was told we had them. Better a visible error on their screen than a silent one
in the base.

It is routed at both `aleandharry.com/api/rsvp` and
`www.aleandharry.com/api/rsvp`, so the form posts to its own origin on either
public hostname and no CORS preflight happens in the browser. Worker routes are
matched ahead of Pages, so those paths are the worker and every other path is
the site.

The worker accepts only the two production origins by default, requires a JSON
content type, rejects missing or malformed JSON objects, caps the complete body
at 32KB, and times out the Airtable request after eight seconds. One Cloudflare
rate-limit binding allows five valid submissions per normalized email per
minute in each Cloudflare location. A separate binding allows 30 valid RSVP
attempts for the endpoint per minute in each location. Its key is a constant
route identifier, not an IP address. The email is hashed before it becomes the
per-email rate-limit key. Both bindings are required and a binding failure
stops the write rather than disabling protection.

The static Pages deployment also supplies a Content Security Policy, HSTS,
clickjacking protection, a referrer policy, and a restrictive Permissions
Policy. The Worker returns its own JSON and CORS headers because Pages header
rules do not apply to Worker responses.

Declaring that route also switches the `workers.dev` URL off, which is what we
want: one public endpoint writing to Airtable rather than two. The CORS handling
in the worker stays, because the local flow below runs the site on port 8000 and
the worker on 8787, which is cross-origin.

To run it against the real base:

```bash
cd worker
echo 'AIRTABLE_RUNTIME_TOKEN=…' > .dev.vars   # gitignored
npx wrangler dev
```

Then point `RSVP_ENDPOINT` in `rsvp.js` at `http://localhost:8787` and add
`RSVP_ALLOWED_ORIGINS=http://localhost:8000` to `worker/.dev.vars`. Note that
this writes real rows to Airtable.

Deploy with `npx wrangler deploy` from `worker/`. The main branch workflow does
this after the site checks and before Pages, so a production Worker deploy does
not drift behind the form code.
