import { setTimeout as delay } from 'node:timers/promises'

import { caseOf, describeTask } from 'vieval'

import { modelOf, repeatOf, seeded } from './shared'

describeTask('logs', () => {
  caseOf('console/levels', async () => {
    // eslint-disable-next-line no-console -- the showcase covers every console method
    console.log('console.log: plain stdout line')
    console.info('console.info: informational line')
    // eslint-disable-next-line no-console -- the showcase covers every console method
    console.debug('console.debug: debug line')
    console.warn('console.warn: something looks off')
    console.error('console.error: something failed (case still passes)')
    console.info('multi-line output:\n  line two of the same call\n  line three of the same call')
    console.info('unicode: 你好, привет, こんにちは, emoji-free text with tabs\tand\ttabs')
    // eslint-disable-next-line no-console -- the showcase covers every console method
    console.log({ nested: { list: [1, 2, 3], value: 1 } })
  })

  caseOf('console/long-3200-lines', async (context) => {
    const model = modelOf(context)
    for (let line = 1; line <= 3200; line += 1) {
      const noise = seeded(`${model}:${line}`)
      if (line % 500 === 0) {
        console.warn(`[${line}/3200] checkpoint: loss ${(1 / line).toFixed(6)}`)
      }
      else {
        console.info(`[${line}/3200] step=${line} reward=${(noise * 2 - 1).toFixed(4)} action=${noise > 0.5 ? 'click' : 'type'}`)
      }
    }
    console.error('[3200/3200] done; one stderr line at the end')
  })

  // Long enough to watch the run live: about 24 s for repeat 1 and 12 s for repeat 2.
  caseOf('slow/observable-progress', async (context) => {
    const steps = repeatOf(context) === 1 ? 24 : 12
    for (let step = 1; step <= steps; step += 1) {
      await delay(1000)
      const latency = Math.round(200 + seeded(`${modelOf(context)}:slow:${step}`) * 600)
      context.recordMetric('slow.step_latency_ms', latency)
      console.info(`step ${step}/${steps}: latency ${latency} ms`)
    }
    return { steps }
  })
})
