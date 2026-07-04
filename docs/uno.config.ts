import { defineConfig, presetWebFonts, presetWind4 } from 'unocss'

/** @see {@link https://github.com/unocss-community/unocss-preset-shadcn#usage} */
export default defineConfig({
  // By default, `.ts` and `.js` files are NOT extracted.
  // If you want to extract them, use the following configuration.
  // It's necessary to add the following configuration if you use shadcn-vue or shadcn-svelte.
  content: {
    pipeline: {
      include: [
        // the default
        /\.(vue|svelte|[jt]sx|mdx?|astro|elm|php|phtml|html)($|\?)/,
        // include js/ts files
        '(components|src)/**/*.{js,ts}',
      ],
    },
  },
  presets: [
    presetWind4({
      dark: {
        dark: ':is(.dark, [data-theme="dark"])',
        light: ':is(.light, [data-theme="light"])',
      },
      preflights: { reset: false },
    }),
    presetWebFonts({
      fonts: {
        'sans': {
          name: 'DM Sans',
          provider: 'fontsource',
        },
        'sans-title': {
          name: 'Momo Trust Display',
          provider: 'google',
        },
      },
    }),
  ],
  theme: {
    colors: {
      beige: 'var(--color-beige)',
      grey: 'var(--color-grey)',
      midnight: 'var(--color-midnight)',
      nickel: 'var(--color-nickel)',
      primary: 'var(--color-primary)',
      slate: 'var(--color-slate)',
      stroke: 'var(--color-stroke)',
      white: 'var(--color-white)',
    },
    fontFamily: {
      'sans': '"DM Sans Variable", "DM Sans", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";',
      'sans-title': '"Momo Trust Display", "DM Sans Variable", "DM Sans", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";',
    },
  },
})
