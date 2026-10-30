// The theme-color meta sets the color behind the iOS status bar when the app is on the home screen. It
// follows the page background, so it matches the theme the person chose (light, dark, or the system's).
// The theme is not known here, so the page's computed background is read after every change.

function apply() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const color = getComputedStyle(document.body).backgroundColor;
  if (meta && color) meta.content = color;
}

/** Keeps theme-color in step with the page background. Call once, when the app starts. */
export function syncThemeColor() {
  apply();
  new MutationObserver(apply).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-palette', 'style'],
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
}
