/* Clicking a photo on Hale enlarges it into the space below the header, which
   stays where it is. The markup stays a plain <figure><img>, so a visitor
   without JavaScript still sees all of them at page size; this only adds the
   way in.

   The same on a phone as on a desktop. A phone gains less, since the photos
   already span its column, but a photo alone on the screen at the full width
   of it is still worth the tap. */
(function () {
  var photos = document.querySelectorAll('.moment img');
  if (!photos.length || !window.HTMLDialogElement || !HTMLDialogElement.prototype.showModal) return;

  // iOS only applies :active to an element the page listens to, and :active
  // is what gives the photo its press under a thumb.
  document.addEventListener('touchstart', function () {}, { passive: true });

  var header = document.querySelector('.site-header');

  var dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.setAttribute('aria-label', 'Enlarged photo');

  var full = document.createElement('img');
  full.className = 'lightbox-image';
  full.alt = '';

  var close = document.createElement('button');
  close.type = 'button';
  close.className = 'lightbox-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';

  dialog.append(full, close);
  document.body.append(dialog);

  // The photo sits below the header rather than over it, and the header is a
  // different height on a narrow window, so its height is measured rather
  // than assumed.
  function measureHeader() {
    var h = header ? Math.round(header.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--header-h', h + 'px');
  }

  /* A real button around each photo rather than a click handler on the image:
     the keyboard reaches it, it takes focus, and a screen reader announces
     that the photo does something. The button itself has no appearance. */
  photos.forEach(function (photo) {
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'zoom';
    // Names the button, which suppresses the image's own alt inside it, so
    // the description is said once rather than twice.
    trigger.setAttribute('aria-label', 'Enlarge: ' + photo.alt);

    photo.replaceWith(trigger);
    trigger.append(photo);

    trigger.addEventListener('click', function () {
      // src, not currentSrc: srcset serves the page whatever fits the column,
      // and enlarging is the one moment the full-size file is worth fetching.
      full.src = photo.src;
      full.alt = photo.alt;
      measureHeader();
      dialog.showModal();
      // A modal dialog does not stop the page behind it scrolling, so a wheel
      // carries the page off to somewhere else while the photo sits still.
      // The reserved gutter means holding the scrollbar back costs no width.
      document.documentElement.classList.add('is-locked');
    });
  });

  // Anywhere closes, the photo and the header included: a click over the
  // header lands on the dialog's backdrop, which reports the dialog as its
  // target, so the first click always puts the photo back.
  dialog.addEventListener('click', function () {
    dialog.close();
  });

  dialog.addEventListener('close', function () {
    document.documentElement.classList.remove('is-locked');
  });

  window.addEventListener('resize', function () {
    if (dialog.open) measureHeader();
  });
})();
