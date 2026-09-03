// Same-origin: a worker route claims this path ahead of the site, so the form
// posts without a preflight. Point it at http://localhost:8787 to test against
// `wrangler dev`, and put it back before committing.
var RSVP_ENDPOINT = '/api/rsvp';

document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('rsvpForm');
  if (!form) return;

  var partyFields = form.querySelectorAll('.field-party');
  var partyInput = document.getElementById('partySize');
  var status = document.getElementById('rsvpStatus');
  var submitButton = form.querySelector('.rsvp-submit');

  function field(id) {
    return document.getElementById(id);
  }

  form.querySelectorAll('input[name="attending"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      var attendingYes = form.querySelector('input[name="attending"]:checked').value === 'Yes';
      partyFields.forEach(function (el) {
        el.classList.toggle('is-hidden', !attendingYes);
      });
      partyInput.required = attendingYes;
    });
  });

  function showStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state;
    status.classList.remove('is-hidden');
  }

  function fail(message, focusId) {
    showStatus(message, 'error');
    if (focusId) field(focusId).focus();
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    if (!field('name').value.trim()) {
      return fail('Please enter a name.', 'name');
    }

    // The form uses novalidate, so this simple check is the only client-side
    // email validation and keeps its error message friendly.
    var email = field('email').value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail('Please enter an email address we can reach you on.', 'email');
    }

    var attendingInput = form.querySelector('input[name="attending"]:checked');
    if (!attendingInput) {
      return fail("Please let us know if you're attending.");
    }

    var attending = attendingInput.value === 'Yes';

    var partySize = attending ? Number(partyInput.value) : 0;
    if (attending && (!Number.isInteger(partySize) || partySize < 1 || partySize > 20)) {
      return fail('Party size must be a whole number between 1 and 20.', 'partySize');
    }

    var payload = {
      name: field('name').value.trim(),
      email: email,
      attending: attendingInput.value,
      partySize: partySize,
      guestNames: attending ? field('guestNames').value.trim() : '',
      dietary: attending ? field('dietary').value.trim() : '',
      message: field('message').value.trim(),
      company: field('company').value,
    };

    submitButton.disabled = true;
    showStatus('Sending…', 'pending');

    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = window.setTimeout(function () {
      if (controller) controller.abort();
    }, 10000);
    var request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
    if (controller) request.signal = controller.signal;

    fetch(RSVP_ENDPOINT, request)
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.data || result.data.ok !== true) {
          throw new Error(result.data && result.data.error ? result.data.error : 'Something went wrong.');
        }
        form.reset();
        partyFields.forEach(function (el) {
          el.classList.add('is-hidden');
        });
        form.classList.add('is-hidden');
        showStatus("Thank you, we've got your RSVP.", 'success');
      })
      .catch(function (err) {
        if (err.name === 'AbortError') {
          showStatus('That took too long. Please try again.', 'error');
        } else {
          showStatus(err.message || 'Something went wrong. Please try again.', 'error');
        }
      })
      .finally(function () {
        window.clearTimeout(timeout);
        submitButton.disabled = false;
      });
  });
});
