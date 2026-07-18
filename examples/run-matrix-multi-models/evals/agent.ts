import { sleep } from '@moeru/std'

export async function extract() {
  await sleep(1000)

  return Math.random()
}
