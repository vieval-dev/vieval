/** The Preferences popover (`PreferencesMenu.vue`) and the color scheme toggle next to it. */
export default {
  accessibility: {
    colorblind: 'Colorblind',
    colorblindHint: 'Status in blue, orange, and yellow instead of green and red',
    title: 'Accessibility',
  },
  appearance: {
    title: 'Appearance',
  },
  language: {
    /** Trigger text while following the browser; `language` is the native name of the resolved locale. */
    auto: 'Auto ({language})',
    followBrowser: 'Auto (follow the browser)',
    title: 'Language',
  },
  scheme: {
    dark: 'Dark mode',
    light: 'Light mode',
  },
  theme: {
    hue: 'Hue',
    palette: 'Palette',
    resetPalette: 'Reset palette',
    title: 'Theme',
  },
  title: 'Preferences',
}
