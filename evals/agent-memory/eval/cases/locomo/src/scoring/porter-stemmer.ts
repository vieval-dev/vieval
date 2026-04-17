function isConsonant(word: string, index: number): boolean {
  const letter = word[index]
  if (letter == null) {
    return false
  }

  if ('aeiou'.includes(letter)) {
    return false
  }

  if (letter === 'y') {
    if (index === 0) {
      return true
    }

    return !isConsonant(word, index - 1)
  }

  return true
}

function measure(word: string): number {
  let count = 0
  let inVowelSequence = false

  for (let i = 0; i < word.length; i += 1) {
    const consonant = isConsonant(word, i)
    if (consonant) {
      if (inVowelSequence) {
        count += 1
      }
      inVowelSequence = false
    }
    else {
      inVowelSequence = true
    }
  }

  return count
}

function hasVowel(word: string): boolean {
  for (let i = 0; i < word.length; i += 1) {
    if (!isConsonant(word, i)) {
      return true
    }
  }
  return false
}

function endsWithDoubleConsonant(word: string): boolean {
  if (word.length < 2) {
    return false
  }

  const last = word[word.length - 1]
  const previous = word[word.length - 2]
  if (last !== previous) {
    return false
  }

  return isConsonant(word, word.length - 1)
}

function cvc(word: string): boolean {
  if (word.length < 3) {
    return false
  }

  const i = word.length - 1
  if (!isConsonant(word, i) || isConsonant(word, i - 1) || !isConsonant(word, i - 2)) {
    return false
  }

  const last = word[i]
  return last !== 'w' && last !== 'x' && last !== 'y'
}

/**
 * Stems a single English token using Porter stemming steps.
 */
export function stemEnglishPorter(word: string): string {
  if (word.length <= 2) {
    return word
  }

  let value = word.toLowerCase()

  if (value.endsWith('sses'))
    value = `${value.slice(0, -4)}ss`
  else if (value.endsWith('ies'))
    value = `${value.slice(0, -3)}i`
  else if (!value.endsWith('ss') && value.endsWith('s'))
    value = value.slice(0, -1)

  if (value.endsWith('eed')) {
    const stem = value.slice(0, -3)
    if (measure(stem) > 0)
      value = `${stem}ee`
  }
  else {
    const suffix = value.endsWith('ed') ? 'ed' : (value.endsWith('ing') ? 'ing' : '')
    if (suffix.length > 0) {
      const stem = value.slice(0, -suffix.length)
      if (hasVowel(stem)) {
        value = stem
        if (value.endsWith('at') || value.endsWith('bl') || value.endsWith('iz'))
          value += 'e'
        else if (endsWithDoubleConsonant(value) && !value.endsWith('l') && !value.endsWith('s') && !value.endsWith('z'))
          value = value.slice(0, -1)
        else if (measure(value) === 1 && cvc(value))
          value += 'e'
      }
    }
  }

  if (value.endsWith('y')) {
    const stem = value.slice(0, -1)
    if (hasVowel(stem))
      value = `${stem}i`
  }

  const step2Rules: Array<[string, string]> = [
    ['ational', 'ate'],
    ['tional', 'tion'],
    ['enci', 'ence'],
    ['anci', 'ance'],
    ['izer', 'ize'],
    ['abli', 'able'],
    ['alli', 'al'],
    ['entli', 'ent'],
    ['eli', 'e'],
    ['ousli', 'ous'],
    ['ization', 'ize'],
    ['ation', 'ate'],
    ['ator', 'ate'],
    ['alism', 'al'],
    ['iveness', 'ive'],
    ['fulness', 'ful'],
    ['ousness', 'ous'],
    ['aliti', 'al'],
    ['iviti', 'ive'],
    ['biliti', 'ble'],
  ]
  for (const [suffix, replacement] of step2Rules) {
    if (value.endsWith(suffix)) {
      const stem = value.slice(0, -suffix.length)
      if (measure(stem) > 0) {
        value = stem + replacement
      }
      break
    }
  }

  const step3Rules: Array<[string, string]> = [
    ['icate', 'ic'],
    ['ative', ''],
    ['alize', 'al'],
    ['iciti', 'ic'],
    ['ical', 'ic'],
    ['ful', ''],
    ['ness', ''],
  ]
  for (const [suffix, replacement] of step3Rules) {
    if (value.endsWith(suffix)) {
      const stem = value.slice(0, -suffix.length)
      if (measure(stem) > 0) {
        value = stem + replacement
      }
      break
    }
  }

  const step4Suffixes = ['al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment', 'ent', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize']
  for (const suffix of step4Suffixes) {
    if (value.endsWith(suffix)) {
      const stem = value.slice(0, -suffix.length)
      if (measure(stem) > 1) {
        value = stem
      }
      break
    }
  }

  if (value.endsWith('ion')) {
    const stem = value.slice(0, -3)
    if (measure(stem) > 1 && (stem.endsWith('s') || stem.endsWith('t'))) {
      value = stem
    }
  }

  if (value.endsWith('e')) {
    const stem = value.slice(0, -1)
    if (measure(stem) > 1 || (measure(stem) === 1 && !cvc(stem))) {
      value = stem
    }
  }

  if (measure(value) > 1 && endsWithDoubleConsonant(value) && value.endsWith('l')) {
    value = value.slice(0, -1)
  }

  return value
}
