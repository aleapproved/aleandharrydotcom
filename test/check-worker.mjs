// The RSVP worker is the only part of this site that takes something from a
// guest and writes it somewhere we cannot edit by hand. The site checks drive
// the form and stop at the submit, because a real one needs the worker; these
// are the other half. They run the worker's own module with fetch stubbed, so
// nothing here reaches Airtable and nothing needs a network.
//
// What is worth checking is not that it works but that it refuses: a party of
// nought, a party of a thousand, an address that is not one, a bot filling in
// every field it can see. And that a refusal still carries the CORS headers,
// since a 400 the browser will not let the page read is a form that fails in
// silence.

const worker = (await import('../worker/src/index.js')).default;

const ORIGIN = 'https://aleandharry.com';
const ENV = {
  AIRTABLE_RUNTIME_TOKEN: 'test-token',
  RSVP_ALLOWED_ORIGINS: `${ORIGIN},https://www.aleandharry.com`,
  RSVP_RATE_LIMITER: {
    async limit({ key }) {
      rateLimitCalls++;
      lastRateLimitKey = key;
      return { success: !rateLimited };
    },
  },
};

let failures = 0;
let rateLimited = false;
let rateLimitCalls = 0;
let lastRateLimitKey = '';
let airtableFailure = null;

function check(name, condition, detail = '') {
  if (condition) return;
  failures++;
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

function section(name) {
  console.log(`\n${name}`);
}

// Everything the worker sends to Airtable lands here instead. Recording the
// calls is the point: the honeypot check is only meaningful if we can see
// that nothing was written.
let calls = [];
let airtableStatus = 200;

globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (airtableFailure) throw airtableFailure;
  return new Response(JSON.stringify({ records: [] }), { status: airtableStatus });
};

async function send(body, {
  method = 'POST',
  status = 200,
  origin = ORIGIN,
  contentType = 'application/json',
  env = ENV,
  failure = null,
} = {}) {
  calls = [];
  airtableStatus = status;
  airtableFailure = failure;
  rateLimitCalls = 0;
  lastRateLimitKey = '';
  const headers = {};
  if (origin !== null) headers.Origin = origin;
  if (method === 'POST' && contentType) headers['Content-Type'] = contentType;
  const request = new Request(`${ORIGIN}/api/rsvp`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: method === 'POST'
      ? (typeof body === 'string' ? body : JSON.stringify(body))
      : undefined,
  });
  const res = await worker.fetch(request, env);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a non-JSON body is itself a failure below */ }
  return { res, json, text, written: calls };
}

// The shape a valid submission has, so each test can name only what it is
// bending and the rest stays obviously fine.
const VALID = {
  name: 'Test Guest',
  email: 'guest@example.com',
  attending: 'Yes',
  partySize: 2,
  guestNames: 'A Plus One',
  dietary: 'No nuts',
  message: 'Congratulations',
};

function fields(written) {
  return JSON.parse(written[0].init.body).records[0].fields;
}

// ---------------------------------------------------------------
section('Worker: method handling');
{
  const preflight = await send(null, { method: 'OPTIONS' });
  check('a preflight is answered', preflight.res.status === 200, `got ${preflight.res.status}`);
  check('the preflight names this origin and no other',
    preflight.res.headers.get('access-control-allow-origin') === ORIGIN,
    preflight.res.headers.get('access-control-allow-origin'));
  check('the preflight allows the form\'s method and header',
    /POST/.test(preflight.res.headers.get('access-control-allow-methods') || '')
    && /Content-Type/i.test(preflight.res.headers.get('access-control-allow-headers') || ''));
  check('the preflight varies by origin', preflight.res.headers.get('vary') === 'Origin');
  check('a preflight writes nothing', preflight.written.length === 0);

  for (const method of ['GET', 'PUT', 'DELETE']) {
    const res = await send(null, { method });
    check(`${method} is refused`, res.res.status === 405, `got ${res.res.status}`);
    check(`${method} writes nothing`, res.written.length === 0);
  }

  const evilPreflight = await send(null, { method: 'OPTIONS', origin: 'https://evil.example' });
  check('a preflight from another origin is refused', evilPreflight.res.status === 403,
    `got ${evilPreflight.res.status}`);
  check('a refused preflight names no allowed origin', !evilPreflight.res.headers.has('access-control-allow-origin'));
}

// ---------------------------------------------------------------
section('Worker: what it refuses');
{
  const noOrigin = await send(VALID, { origin: null });
  check('a POST without an origin is refused', noOrigin.res.status === 403, `got ${noOrigin.res.status}`);
  check('a POST without an origin writes nothing', noOrigin.written.length === 0);

  const evilOrigin = await send(VALID, { origin: 'https://evil.example' });
  check('a POST from another origin is refused', evilOrigin.res.status === 403,
    `got ${evilOrigin.res.status}`);
  check('a POST from another origin writes nothing', evilOrigin.written.length === 0);

  const wrongContentType = await send(JSON.stringify(VALID), { contentType: 'text/plain' });
  check('a non-JSON content type is refused', wrongContentType.res.status === 415,
    `got ${wrongContentType.res.status}`);
  check('a non-JSON content type writes nothing', wrongContentType.written.length === 0);

  const bad = await send('not json at all');
  check('a body that is not JSON is refused', bad.res.status === 400, `got ${bad.res.status}`);
  check('a refusal still carries the CORS header',
    bad.res.headers.get('access-control-allow-origin') === ORIGIN);
  check('a refusal explains itself', typeof bad.json?.error === 'string' && bad.json.error.length > 0);

  const cases = [
    ['a null body', null],
    ['an array body', []],
    ['a boolean body', true],
    ['no name', { ...VALID, name: '' }],
    ['a name that is only spaces', { ...VALID, name: '   ' }],
    ['a missing name', { ...VALID, name: undefined }],
    ['a name that is not a string', { ...VALID, name: 42 }],
    ['no email', { ...VALID, email: '' }],
    ['an address with no @', { ...VALID, email: 'guest.example.com' }],
    ['an address with no domain', { ...VALID, email: 'guest@' }],
    ['an address with no dot', { ...VALID, email: 'guest@example' }],
    ['an address with a space', { ...VALID, email: 'gu est@example.com' }],
    ['no answer on attending', { ...VALID, attending: undefined }],
    ['an answer that is neither', { ...VALID, attending: 'Maybe' }],
    ['a lowercase yes', { ...VALID, attending: 'yes' }],
    ['a party of nought', { ...VALID, partySize: 0 }],
    ['a negative party', { ...VALID, partySize: -3 }],
    ['a party of a thousand', { ...VALID, partySize: 1000 }],
    ['half a guest', { ...VALID, partySize: 2.5 }],
    ['a boolean party size', { ...VALID, partySize: true }],
    ['a party that is not a number', { ...VALID, partySize: 'lots' }],
    ['a missing party size', { ...VALID, partySize: undefined }],
  ];
  for (const [what, payload] of cases) {
    const res = await send(payload);
    check(`${what} is refused`, res.res.status === 400, `got ${res.res.status}`);
    check(`${what} writes nothing`, res.written.length === 0);
  }

  const oversized = await send({ ...VALID, message: 'x'.repeat(40_000) });
  check('a body over 32KB is refused', oversized.res.status === 413,
    `got ${oversized.res.status}`);
  check('an oversized body writes nothing', oversized.written.length === 0);
}

// ---------------------------------------------------------------
section('Worker: the honeypot');
{
  // A bot that fills in the hidden field is told everything went fine and
  // nothing is stored. Being told it failed would only teach it to try again.
  const trap = await send({ ...VALID, company: 'Acme Ltd' });
  check('a filled honeypot is thanked', trap.res.status === 200, `got ${trap.res.status}`);
  check('a filled honeypot looks like a success', trap.json?.ok === true);
  check('a filled honeypot stores nothing', trap.written.length === 0,
    `${trap.written.length} write(s)`);
}

// ---------------------------------------------------------------
section('Worker: what it accepts');
{
  const ok = await send(VALID);
  check('a good submission is accepted', ok.res.status === 200, `got ${ok.res.status}`);
  check('a good submission says so', ok.json?.ok === true);
  check('a good submission is written once', ok.written.length === 1);
  check('a good submission is rate limited by a non-email key', rateLimitCalls === 1 && lastRateLimitKey && !lastRateLimitKey.includes(VALID.email),
    `${rateLimitCalls} call(s), ${lastRateLimitKey}`);
  check('it is written to the right table',
    ok.written[0].url === 'https://api.airtable.com/v0/appzg1GJnurC95pqv/tblN2FjbFfsoTGJkH',
    ok.written[0].url);
  check('it is written with the runtime token',
    ok.written[0].init.headers.Authorization === 'Bearer test-token');

  // The column names are Airtable's, not ours. Renaming one here without
  // renaming it there loses the answer silently, which is the worst way to
  // lose it, so they are spelled out.
  const written = fields(ok.written);
  check('the columns are the ones Airtable has',
    JSON.stringify(Object.keys(written).sort()) === JSON.stringify(
      ['Attending', 'Dietary Requirements', 'Email', 'Guest Names', 'Message', 'Name', 'Party Size'].sort()),
    Object.keys(written).join(', '));
  check('the answers arrive as given',
    written.Name === 'Test Guest' && written.Email === 'guest@example.com'
    && written.Attending === 'Yes' && written['Party Size'] === 2
    && written['Guest Names'] === 'A Plus One'
    && written['Dietary Requirements'] === 'No nuts'
    && written.Message === 'Congratulations',
    JSON.stringify(written));

  const trimmed = await send({ ...VALID, name: '  Test Guest  ', email: '  guest@example.com ' });
  check('surrounding space is trimmed off', fields(trimmed.written).Name === 'Test Guest',
    JSON.stringify(fields(trimmed.written).Name));

  for (const size of [1, 20]) {
    const res = await send({ ...VALID, partySize: size });
    check(`a party of ${size} is allowed`, res.res.status === 200, `got ${res.res.status}`);
  }

  // Somebody who is not coming has no party, no seats and no dietary needs.
  // Whatever the form sent for those is dropped rather than stored as stale
  // text under a "No".
  const declined = await send({ ...VALID, attending: 'No', partySize: 6 });
  check('a no is accepted', declined.res.status === 200, `got ${declined.res.status}`);
  const declinedFields = fields(declined.written);
  check('a no brings no party', declinedFields['Party Size'] === 0, declinedFields['Party Size']);
  check('a no brings no guest names', declinedFields['Guest Names'] === '');
  check('a no brings no dietary needs', declinedFields['Dietary Requirements'] === '');
  check('a no keeps its message', declinedFields.Message === 'Congratulations');
  check('a no needs no party size',
    (await send({ ...VALID, attending: 'No', partySize: undefined })).res.status === 200);

  const www = await send({ ...VALID, email: 'www@example.com' }, { origin: 'https://www.aleandharry.com' });
  check('the www origin is accepted', www.res.status === 200, `got ${www.res.status}`);
  check('the www origin is echoed for CORS', www.res.headers.get('access-control-allow-origin') === 'https://www.aleandharry.com');
}

// ---------------------------------------------------------------
section('Worker: limits');
{
  // Nothing unbounded reaches Airtable. The caps are the worker's, so this is
  // the only place they are enforced.
  const long = await send({
    ...VALID,
    name: 'n'.repeat(500),
    guestNames: 'g'.repeat(4000),
    dietary: 'd'.repeat(4000),
    message: 'm'.repeat(4000),
  });
  check('an over-long submission is not refused outright', long.res.status === 200,
    `got ${long.res.status}`);
  const capped = fields(long.written);
  check('the name is capped at 200', capped.Name.length === 200, capped.Name.length);
  check('the guest names are capped at 2000', capped['Guest Names'].length === 2000,
    capped['Guest Names'].length);
  check('the dietary note is capped at 1000', capped['Dietary Requirements'].length === 1000,
    capped['Dietary Requirements'].length);
  check('the message is capped at 2000', capped.Message.length === 2000, capped.Message.length);
  check('capping the free text does not cost the address',
    capped.Email === VALID.email, capped.Email);

  // An address is the one field a cap must not quietly shorten. This one is a
  // real address 209 characters long; cut to 200 it ends "…sub.ex", which
  // still passes the address test and would be stored as somewhere nobody
  // lives, under a guest who was told we had them. It has to be refused.
  const longEmail = `guest@${'sub.'.repeat(48)}example.com`;
  const cut = longEmail.slice(0, 200);
  check('the test address is one truncation would hide',
    longEmail.length > 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cut) && cut !== longEmail,
    `${longEmail.length} chars`);

  const overlong = await send({ ...VALID, email: longEmail });
  check('an over-long address is refused, not shortened', overlong.res.status === 400,
    `got ${overlong.res.status}`);
  check('an over-long address stores nothing', overlong.written.length === 0,
    overlong.written.length ? JSON.stringify(fields(overlong.written).Email) : '');
  check('the guest is told which field to fix', /email/i.test(overlong.json?.error || ''),
    overlong.json?.error);

  // The boundary itself still works, so the cap is a limit and not an
  // off-by-one that refuses addresses it should take.
  const exact = `${'g'.repeat(200 - '@example.com'.length)}@example.com`;
  check('an address of exactly 200 is accepted',
    exact.length === 200 && (await send({ ...VALID, email: exact })).res.status === 200);
}

// ---------------------------------------------------------------
section('Worker: when Airtable is down');
{
  // The guest gets an apology and an invitation to try again, and never a
  // stack trace or anything about Airtable, which is not their problem.
  const down = await send(VALID, { status: 500 });
  check('an Airtable failure is reported as a bad gateway', down.res.status === 502,
    `got ${down.res.status}`);
  check('the guest is asked to try again', /try again/i.test(down.json?.error || ''),
    down.json?.error);
  check('the guest is told nothing about Airtable', !/airtable|token|bearer/i.test(down.text),
    down.text);
  check('a failure still carries the CORS header',
    down.res.headers.get('access-control-allow-origin') === ORIGIN);

  const denied = await send(VALID, { status: 401 });
  check('a rejected token is reported the same way', denied.res.status === 502,
    `got ${denied.res.status}`);

  const network = await send(VALID, { failure: new Error('network down') });
  check('a network failure is reported as a bad gateway', network.res.status === 502,
    `got ${network.res.status}`);
}

// ---------------------------------------------------------------
section('Worker: abuse and configuration failures');
{
  rateLimited = true;
  const limited = await send(VALID);
  rateLimited = false;
  check('a rate-limited submission is refused', limited.res.status === 429,
    `got ${limited.res.status}`);
  check('a rate-limited submission asks the guest to wait', /wait/i.test(limited.json?.error || ''));
  check('a rate-limited submission writes nothing', limited.written.length === 0);

  const missingToken = await send(VALID, {
    env: { ...ENV, AIRTABLE_RUNTIME_TOKEN: undefined },
  });
  check('a missing Airtable token fails closed', missingToken.res.status === 500,
    `got ${missingToken.res.status}`);
  check('a missing Airtable token writes nothing', missingToken.written.length === 0);
}

console.log(failures === 0 ? '\nAll worker checks passed.\n' : `\n${failures} worker check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
