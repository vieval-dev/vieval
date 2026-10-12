// Component tests render with the app's real styles: virtualized lists size their scroll containers with UnoCSS
// classes, so without the stylesheet every row would render.
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
