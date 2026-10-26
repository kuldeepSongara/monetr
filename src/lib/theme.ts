/*
 * The accent can be any colour — including white or black — so it has to adapt to the theme:
 * white on a light background (or black on a dark one) would make active tabs, toggles and the
 * add button disappear. We keep the chosen colour when it stands out from the background and fall
 * back to the theme's ink colour when it doesn't, and pick a readable foreground for anything
 * drawn on top of an accent fill.
 */

type RGB = [number, number, number]

export function hexToRgb(hex: string): RGB | null {
  const clean = hex.replace('#', '').trim()
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  const n = Number.parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance([r, g, b]: RGB): number {
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const THEME = {
  light: { bg: [255, 255, 255] as RGB, ink: [9, 9, 11] as RGB },
  dark: { bg: [9, 9, 11] as RGB, ink: [250, 250, 250] as RGB },
}

/** CSS triplets for `--accent` and `--accent-fg` in the given theme. */
export function accentVars(hex: string, theme: 'light' | 'dark'): { accent: string; accentFg: string } {
  const t = THEME[theme]
  const chosen = hexToRgb(hex) ?? t.ink
  // Below 3:1 against the page the accent can't carry an active tab or a toggle — use the ink colour.
  const accent = contrast(chosen, t.bg) >= 3 ? chosen : t.ink
  const white: RGB = [255, 255, 255]
  const black: RGB = [9, 9, 11]
  const fg = contrast(white, accent) >= contrast(black, accent) ? white : black
  return { accent: accent.join(' '), accentFg: fg.join(' ') }
}
