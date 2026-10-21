import { TooltipProvider } from 'reka-ui'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'

import ArtifactViewer from './ArtifactViewer.vue'

import { i18n } from '../i18n'

const location = { path: 'task/case/file', runKey: 'run-1-a' }

/** Renders the viewer under a `TooltipProvider`, as `App.vue` does for every page (its icon buttons need one). */
function renderViewer(props: InstanceType<typeof ArtifactViewer>['$props']) {
  return render(defineComponent(() => () => h(TooltipProvider, null, () => h(ArtifactViewer, props))))
}

describe('artifactViewer', () => {
  /**
   * @example
   * expect(iframe.getAttribute('sandbox')).toBe('')
   */
  it('renders HTML in an iframe sandbox without scripts or same-origin access', async () => {
    const screen = await renderViewer({ contentType: 'text/html', location, name: 'report.html', previewKind: 'html', size: 10 })
    const iframe = screen.container.querySelector('iframe')!
    expect(iframe.getAttribute('sandbox')).toBe('')
    expect(iframe.getAttribute('src')).toContain('/api/runs/run-1-a/artifacts/raw?path=task%2Fcase%2Ffile')
  })

  /**
   * @example
   * expect(screen.getByText('No preview for this file type')).toBeVisible()
   */
  it('offers a download for binary files instead of a preview', async () => {
    const screen = await renderViewer({ contentType: 'application/octet-stream', location, name: 'dump.bin', previewKind: 'binary', size: 8192 })
    await expect.element(screen.getByText('No preview for this file type')).toBeVisible()
    const link = screen.getByRole('link', { name: 'Download dump.bin' })
    await expect.element(link).toHaveAttribute('href', expect.stringContaining('download=1'))
  })

  /**
   * @example
   * i18n.global.locale.value = 'zh-Hans'
   * expect(screen.getByText('无法预览这种文件类型')).toBeVisible()
   */
  it('explains a file without a preview in the language picked for the viewer', async () => {
    i18n.global.locale.value = 'zh-Hans'
    const screen = await renderViewer({ contentType: 'application/octet-stream', location, name: 'dump.bin', previewKind: 'binary', size: 8192 })
    await expect.element(screen.getByText('无法预览这种文件类型')).toBeVisible()
    await expect.element(screen.getByRole('link', { name: '下载 dump.bin' })).toBeVisible()
  })

  /**
   * @example
   * expect(video.hasAttribute('controls')).toBe(true)
   */
  it('plays video and audio with native controls', async () => {
    const video = await renderViewer({ contentType: 'video/webm', location, name: 'clip.webm', previewKind: 'video', size: 1 })
    expect(video.container.querySelector('video')?.hasAttribute('controls')).toBe(true)
    const audio = await renderViewer({ contentType: 'audio/wav', location, name: 'tone.wav', previewKind: 'audio', size: 1 })
    expect(audio.container.querySelector('audio')?.hasAttribute('controls')).toBe(true)
  })
})
