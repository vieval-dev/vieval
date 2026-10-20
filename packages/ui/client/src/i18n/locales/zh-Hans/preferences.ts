import type en from '../en/preferences'

export default {
  accessibility: {
    colorblind: '色盲模式',
    colorblindHint: '用蓝色、橙色和黄色代替绿色和红色表示状态',
    title: '无障碍',
  },
  language: {
    auto: '自动（{language}）',
    followBrowser: '自动（跟随浏览器）',
    title: '语言',
  },
  scheme: {
    dark: '深色模式',
    light: '浅色模式',
  },
  theme: {
    hue: '色相',
    palette: '配色',
    resetPalette: '重置配色',
    title: '主题',
  },
  title: '偏好设置',
} satisfies typeof en
