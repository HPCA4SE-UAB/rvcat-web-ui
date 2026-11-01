function linearizeChannel(channel) {
  const normalized = channel / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function getContrastingTextColor([red, green, blue]) {
  const luminance = 0.2126 * linearizeChannel(red)
    + 0.7152 * linearizeChannel(green)
    + 0.0722 * linearizeChannel(blue)
  const blackContrast = (luminance + 0.05) / 0.05
  const whiteContrast = 1.05 / (luminance + 0.05)

  return blackContrast >= whiteContrast ? 'black' : 'white'
}

export function getCriticalityStyle(percentage) {
  if (!Number.isFinite(percentage))
    return {}

  const p = Math.max(0, Math.min(100, percentage))
  const red = Math.round(Math.min(255, (p / 50) * 255))
  const green = Math.round(p < 50 ? (p / 50) * 255 : ((100 - p) / 50) * 255)
  const blue = Math.round(Math.max(0, (1 - p / 50) * 255))
  const mixWhite = 0.7
  const channels = [red, green, blue].map(channel =>
    Math.round(channel + (255 - channel) * mixWhite)
  )

  return {
    backgroundColor: `rgb(${channels.join(', ')})`,
    color: getContrastingTextColor(channels)
  }
}
