// Applies the saved or system color scheme before the first paint (a classic script, so it runs before the app).
// `useDark` in `src/App.vue` owns the value afterwards: it stores 'dark', 'light', or 'auto' (follow the system).
const scheme = localStorage.getItem('vieval-viewer:scheme')
if (scheme === 'dark' || ((scheme == null || scheme === 'auto') && matchMedia('(prefers-color-scheme: dark)').matches))
  document.documentElement.classList.add('dark')

// Applies the saved theme hue before the first paint. `src/theme.ts` owns the key and the default (keep in sync);
// `useThemeHue` updates the variable afterwards.
const hue = Number.parseFloat(localStorage.getItem('vieval-viewer:hue') ?? '')
document.documentElement.style.setProperty('--chromatic-hue', String(Number.isFinite(hue) ? Math.min(360, Math.max(0, hue)) : 55))

// Applies the saved colorblind-safe state colors before the first paint, so bars do not flash green and red first.
// `src/theme.ts` owns the key (keep in sync); `useColorVision` updates the attribute afterwards.
if (localStorage.getItem('vieval-viewer:color-vision') === 'safe')
  document.documentElement.dataset.colorVision = 'safe'
