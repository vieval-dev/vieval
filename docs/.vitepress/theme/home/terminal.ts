/**
 * One colored run of text in a mock terminal line.
 */
export interface TerminalSegment {
  text: string
  /** Color role; plain text when omitted. */
  tone?: 'accent' | 'badge' | 'error' | 'muted' | 'number' | 'success'
}

const patterns: [RegExp, TerminalSegment['tone']][] = [
  [/^RUN\b/, 'accent'],
  [/^✓/, 'success'],
  [/^✗/, 'error'],
  [/^\|[^|]+\|/, 'badge'],
  [/^\([^)]*\)/, 'muted'],
  [/^report .*$/, 'muted'],
  [/^matrix run\b/, 'muted'],
  [/^\s\|\s/, 'muted'],
  [/^passed\b/, 'success'],
  [/^failed\b/, 'error'],
  [/^timeout\b/, 'muted'],
  [/^\d+(?:\.\d+)?\b/, 'number'],
]

/**
 * Normalizes a line of `vieval` CLI output into colored segments for the home page terminal.
 *
 * Before:
 * - "  cases 198 passed | 3 failed"
 *
 * After:
 * - [{ text: "  cases " }, { text: "198", tone: "number" }, { text: " " }, { text: "passed", tone: "success" }, ...]
 */
export function tokenizeTerminalLine(line: string): TerminalSegment[] {
  if (line.startsWith('$')) {
    return [
      { text: '$', tone: 'muted' },
      { text: line.slice(1) },
    ]
  }

  const segments: TerminalSegment[] = []
  let rest = line

  while (rest.length > 0) {
    const match = patterns
      .map(([pattern, tone]) => ({ match: pattern.exec(rest), tone }))
      .find(({ match }) => match)

    if (match?.match) {
      const [text] = match.match
      segments.push({ text, tone: match.tone })
      rest = rest.slice(text.length)
      continue
    }

    let nextIndex = rest.length

    for (let index = 1; index < rest.length; index++) {
      if (patterns.some(([pattern]) => pattern.test(rest.slice(index)))) {
        nextIndex = index
        break
      }
    }

    segments.push({ text: rest.slice(0, nextIndex) })
    rest = rest.slice(nextIndex)
  }

  return segments
}
