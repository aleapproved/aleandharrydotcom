// Each page is a different colour, so the browser chrome cannot be hardcoded
// here: the two papers come off <html>, alongside the pre-paint script's.
function syncThemeColorMeta(theme) {
  var root = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? root.dataset.paperDark : root.dataset.paper);
}

function isTheme(theme) {
  return theme === 'dark' || theme === 'light';
}

function systemTheme() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  } catch (e) {
    return 'light';
  }
}

function storedTheme() {
  try {
    var saved = localStorage.getItem('theme');
    return isTheme(saved) ? saved : null;
  } catch (e) {
    return null;
  }
}

function resolvedTheme() {
  var declared = document.documentElement.getAttribute('data-theme');
  return isTheme(declared) ? declared : (storedTheme() || systemTheme());
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  syncThemeColorMeta(theme);
}

document.addEventListener('DOMContentLoaded', function () {
  var theme = resolvedTheme();
  applyTheme(theme);

  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var current = resolvedTheme();
    var next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch (e) {}
  });
});
