import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { caseOf, describeTask } from 'vieval'

import { fixturePath, modelOf, repeatOf, seeded } from './shared'

function createBinary(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(new TextEncoder().encode('VIEVALBIN\0'))
  let state = 0x2F6B_1D3A
  for (let index = 10; index < size; index += 1) {
    // xorshift32: random-looking but stable bytes.
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[index] = state & 0xFF
  }

  return bytes
}

function createJsonl(model: string, rows: number): string {
  const splits = ['train', 'validation', 'test']
  const lines: string[] = []
  for (let index = 0; index < rows; index += 1) {
    const noise = seeded(`${model}:${index}`)
    lines.push(JSON.stringify({
      answer: String(index + (index % 17)),
      id: `sample-${String(index).padStart(5, '0')}`,
      index,
      latencyMs: Math.round(80 + noise * 900),
      model,
      passed: noise > 0.2,
      prompt: `Question ${index}: what is ${index} + ${index % 17}?`,
      score: Math.round(noise * 1000) / 1000,
      split: splits[index % splits.length],
      tags: noise > 0.9 ? ['hard', 'long'] : ['easy'],
      tokens: { input: 20 + (index % 40), output: Math.round(5 + noise * 60) },
    }))
  }

  return `${lines.join('\n')}\n`
}

/**
 * Builds a 16-bit mono PCM WAV file: a two-tone chime that fades out.
 *
 * WAV files are gitignored, so the audio artifact is generated at run time.
 */
function createWav(seconds: number, sampleRate = 22_050): Uint8Array {
  const sampleCount = Math.round(seconds * sampleRate)
  const buffer = Buffer.alloc(44 + sampleCount * 2)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + sampleCount * 2, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(sampleCount * 2, 40)

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate
    const frequency = time < seconds / 2 ? 523.25 : 659.25
    const envelope = Math.exp(-3 * (time % (seconds / 2)))
    const sample = Math.sin(2 * Math.PI * frequency * time) * envelope * 0.6
    buffer.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2)
  }

  return buffer
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sandboxed HTML artifact</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; background: #f4f1ea; color: #2b2b2b; }
    .card { border-radius: 12px; padding: 16px 20px; background: #fff; box-shadow: 0 2px 8px rgb(0 0 0 / 12%); }
    .ok { color: #1f7a3a; font-weight: 600; }
    #script-status { margin-top: 12px; padding: 8px; border: 2px dashed #1f7a3a; }
    table { border-collapse: collapse; margin-top: 12px; }
    td, th { border: 1px solid #ccc; padding: 4px 10px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Evaluator report</h1>
    <p class="ok">Static content renders with its own styles.</p>
    <table>
      <tr><th>metric</th><th>value</th></tr>
      <tr><td>exact</td><td>0.82</td></tr>
      <tr><td>judge</td><td>0.77</td></tr>
    </table>
    <div id="script-status">Scripts are blocked: this text was not replaced.</div>
  </div>
  <script>
    // When scripts run, the page turns red and says so. The viewer's sandbox must keep this text unchanged.
    document.body.style.background = '#c62828'
    document.getElementById('script-status').textContent = 'SCRIPT RAN: the sandbox did not block inline scripts!'
    try { window.parent.document.title = 'hijacked by artifact' } catch {}
    try { localStorage.setItem('vieval-showcase', 'script-ran') } catch {}
  </script>
</body>
</html>
`

describeTask('artifacts', () => {
  caseOf('image/png', async (context) => {
    await context.recordArtifact('image.png', {
      contentType: 'image/png',
      path: fixturePath('image.png'),
      purpose: 'showcase.image',
    })
  })

  caseOf('image/webp-screenshot-sequence', async (context) => {
    for (let frame = 1; frame <= 6; frame += 1) {
      const name = `frame-${String(frame).padStart(2, '0')}.webp`
      console.info(`captured screenshot ${name}`)
      await context.recordArtifact(name, {
        contentType: 'image/webp',
        path: fixturePath(`frames/${name}`),
        purpose: 'showcase.screenshot',
      })
    }
  })

  caseOf('video/webm', async (context) => {
    await context.recordArtifact('clip.webm', {
      contentType: 'video/webm',
      path: fixturePath('clip.webm'),
      purpose: 'showcase.screen_recording',
    })
  })

  caseOf('audio/wav', async (context) => {
    await context.recordArtifact('chime.wav', {
      body: createWav(2),
      contentType: 'audio/wav',
      purpose: 'showcase.audio',
    })
  })

  caseOf('data/jsonl-20000-rows', async (context) => {
    const rows = 20_000 + repeatOf(context) * 500
    await context.recordArtifact('samples.jsonl', {
      body: createJsonl(modelOf(context), rows),
      contentType: 'application/jsonl',
      purpose: 'showcase.dataset',
    })
    return { rows }
  })

  caseOf('data/json-nested', async (context) => {
    const body = {
      config: {
        stop: ['\n\n', '</answer>'],
        temperature: 0.2,
        tools: [{ name: 'search', parameters: { query: { type: 'string' } } }],
      },
      model: modelOf(context),
      repeat: repeatOf(context),
      results: Array.from({ length: 5 }, (_, index) => ({
        id: index,
        steps: [{ action: 'click', x: index * 10, y: index * 20 }, { action: 'type', text: `hello ${index}` }],
        verdict: { passed: index !== 3, reason: index === 3 ? 'wrong field' : null },
      })),
    }
    await context.recordArtifact('result.json', {
      body: `${JSON.stringify(body, null, 2)}\n`,
      contentType: 'application/json',
      purpose: 'showcase.json',
    })
  })

  caseOf('data/yaml', async (context) => {
    const body = [
      '# Agent configuration used for this case',
      `model: ${modelOf(context)}`,
      `repeat: ${repeatOf(context)}`,
      'agent:',
      '  max_steps: 15',
      '  observation: screenshot',
      '  tools:',
      '    - name: click',
      '      args: [x, y]',
      '    - name: type',
      '      args: [text]',
      'judge:',
      '  rubric: |',
      '    The task is solved when the settings page shows',
      '    the requested value.',
      '',
    ].join('\n')
    await context.recordArtifact('agent.yaml', {
      body,
      contentType: 'application/yaml',
      purpose: 'showcase.yaml',
    })
  })

  caseOf('data/toml', async (context) => {
    const body = [
      '# Environment description',
      'title = "showcase environment"',
      '',
      '[run]',
      `model = "${modelOf(context)}"`,
      `repeat = ${repeatOf(context)}`,
      'started = 2026-10-12T04:00:00Z',
      '',
      '[vm]',
      'image = "ubuntu-24.04"',
      'cpus = 4',
      'memory_gb = 8.5',
      '',
      '[[vm.disks]]',
      'name = "root"',
      'size_gb = 40',
      '',
      '[[vm.disks]]',
      'name = "scratch"',
      'size_gb = 10',
      '',
    ].join('\n')
    await context.recordArtifact('environment.toml', {
      body,
      contentType: 'application/toml',
      purpose: 'showcase.toml',
    })
  })

  caseOf('text/plain-and-unannounced-file', async (context) => {
    const lines = Array.from({ length: 400 }, (_, index) => `${String(index + 1).padStart(3, '0')} | ${new Date(Date.UTC(2026, 9, 12, 4, 0, index)).toISOString()} | step ${index + 1}: observation ok, reward ${(seeded(String(index)) * 2 - 1).toFixed(3)}`)
    await context.recordArtifact('trajectory.txt', {
      body: `${lines.join('\n')}\n`,
      contentType: 'text/plain',
      purpose: 'showcase.text',
    })
    // Written into the case directory without `recordArtifact`: the viewer lists it with `source: 'directory'`.
    await writeFile(join(context.artifactsDirectory, 'unannounced-notes.md'), '# Notes\n\nThis file has no `artifact.recorded` event.\n')
  })

  caseOf('html/sandboxed-script', async (context) => {
    await context.recordArtifact('report.html', {
      body: html,
      contentType: 'text/html',
      purpose: 'showcase.html',
    })
  })

  caseOf('binary/octet-stream', async (context) => {
    await context.recordArtifact('memory-dump.bin', {
      body: createBinary(8192),
      contentType: 'application/octet-stream',
      purpose: 'showcase.binary',
    })
  })
})
