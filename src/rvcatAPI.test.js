import { describe, expect, it } from 'vitest'
import { pyJSON } from './rvcatAPI'

describe('pyJSON', () => {
  it('wraps JSON text in a json.loads call with a quoted string literal', () => {
    expect(pyJSON('{"a": true, "b": null}'))
      .toBe(`__import__('json').loads("{\\"a\\": true, \\"b\\": null}")`)
  })

  it('escapes quotes, backslashes and newlines so they cannot break the Python code', () => {
    const text = JSON.stringify({ text: 'x = "q" \\ \'y\'\nz' }, null, 2)
    const code = pyJSON(text)
    const literal = code.slice("__import__('json').loads(".length, -1)
    expect(JSON.parse(literal)).toBe(text)
    expect(code).not.toContain('\n')
  })
})
