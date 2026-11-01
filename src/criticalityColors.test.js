import { describe, expect, it } from 'vitest'
import { getCriticalityStyle } from './criticalityColors'

function getContrastRatio(backgroundColor, textColor) {
  const channels = backgroundColor.match(/\d+/g).map(Number)
  const linearize = channel => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * linearize(channels[0])
    + 0.7152 * linearize(channels[1])
    + 0.0722 * linearize(channels[2])
  const textLuminance = textColor === 'black' ? 0 : 1

  return (Math.max(luminance, textLuminance) + 0.05)
    / (Math.min(luminance, textLuminance) + 0.05)
}

describe('criticality colors', () => {
  it('preserves the existing background gradient', () => {
    expect(getCriticalityStyle(0).backgroundColor).toBe('rgb(179, 179, 255)')
    expect(getCriticalityStyle(50).backgroundColor).toBe('rgb(255, 255, 179)')
    expect(getCriticalityStyle(100).backgroundColor).toBe('rgb(255, 179, 179)')
  })

  it('keeps text contrast at WCAG AA level throughout the gradient', () => {
    for (let percentage = 0; percentage <= 100; percentage += 0.1) {
      const { backgroundColor, color } = getCriticalityStyle(percentage)
      expect(getContrastRatio(backgroundColor, color)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('uses dark text around the previous low-contrast threshold', () => {
    expect(getCriticalityStyle(50).color).toBe('black')
    expect(getCriticalityStyle(51).color).toBe('black')
  })

  it('returns an empty style for non-finite percentages', () => {
    expect(getCriticalityStyle(Number.NaN)).toEqual({})
    expect(getCriticalityStyle(Number.POSITIVE_INFINITY)).toEqual({})
  })
})
