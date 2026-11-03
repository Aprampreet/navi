import {createTheme} from '../src/ui/design';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 :
    Math.pow((value + 0.055) / 1.055, 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('NAVI visual accessibility', () => {
  test.each([
    [false, 'dark'], [false, 'light'], [true, 'dark'],
  ] as const)('text and controls meet contrast targets, contrast %s, %s', (highContrast, appearance) => {
    const theme = createTheme(highContrast, false, appearance);
    for (const surface of [theme.background, theme.surface, theme.surfaceRaised]) {
      expect(contrast(theme.text, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.secondary, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.accentInk, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.border, surface)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(theme.accentText, theme.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.accentInk, theme.background)).toBeGreaterThanOrEqual(4.5);
  });

  test('large text setting increases type scale', () => {
    expect(createTheme(false, true).scale).toBeGreaterThan(createTheme(false, false).scale);
  });
});
