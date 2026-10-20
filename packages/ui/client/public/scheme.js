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

// Sets `<html lang>` to the saved or browser language before the first paint, so the right CJK font and hyphenation
// apply at once. `src/i18n/index.ts` owns the key and the locales, and `resolveLocale` the matching (keep in sync):
// the first browser language with the same language and script as a supported locale (`zh-CN` → `zh-Hans`), else `en`.
// `useLocale` updates the attribute afterwards.
const savedLocale = localStorage.getItem('vieval-viewer:locale')
let lang = savedLocale === 'en' || savedLocale === 'zh-Hans' ? savedLocale : undefined
for (const tag of navigator.languages) {
  if (lang != null)
    break
  try {
    const locale = new Intl.Locale(tag).maximize()
    if (locale.language === 'en')
      lang = 'en'
    else if (locale.language === 'zh' && locale.script === 'Hans')
      lang = 'zh-Hans'
  }
  catch {}
}
document.documentElement.lang = lang ?? 'en'
