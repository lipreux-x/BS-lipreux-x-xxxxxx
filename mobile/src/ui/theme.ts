// SPEC §8: black vault, Or Coffre accent, forest green for my messages.
export const colors = {
  bg: '#000000',
  surface: '#0D0D0D',
  surface2: '#1A1A1A',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textDim: '#8A8A8A',
  gold: '#D4AF37',
  forest: '#1E6B34', // white text on it: 6.6:1
  danger: '#E5484D',
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 } as const;

export const type = {
  title: { color: colors.text, fontSize: 28, fontWeight: '700' as const, letterSpacing: 0.5 },
  heading: { color: colors.text, fontSize: 20, fontWeight: '600' as const },
  body: { color: colors.text, fontSize: 16 },
  dim: { color: colors.textDim, fontSize: 14 },
};
