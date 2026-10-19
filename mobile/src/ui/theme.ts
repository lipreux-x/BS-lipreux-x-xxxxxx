import { Platform } from 'react-native';

// SPEC §8: black vault, anthracite grey accent (also my messages), forest green for the send key and "open".
export const colors = {
  bg: '#000000',
  surface: '#0D0D0D',
  surface2: '#1A1A1A',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textDim: '#8A8A8A',
  accent: '#383E42', // anthracite (RAL 7016): fills only — white text on it is 11:1
  accentFg: '#9AA1A7', // light anthracite: strokes and text on black (7.8:1)
  forest: '#1E6B34', // white text on it: 6.6:1
  danger: '#E5484D',
} as const;

/**
 * Space Grotesk (geometric, "tech") for the wordmark, titles, keypad digits
 * and buttons; body text stays on the system font for readability. Each
 * weight is its own family: set `fontFamily`, never `fontWeight`, with these.
 */
export const fonts = {
  regular: 'SpaceGrotesk_400Regular',
  medium: 'SpaceGrotesk_500Medium',
  semibold: 'SpaceGrotesk_600SemiBold',
  bold: 'SpaceGrotesk_700Bold',
} as const;

/** Monospace of the safe's LCD screens (code display, timestamps). */
export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Status LEDs, as on the safe's code display. */
export const led = { green: '#3DD68C', amber: '#E8A33D' } as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 } as const;

export const type = {
  title: { color: colors.text, fontSize: 28, fontFamily: fonts.bold, letterSpacing: 0.5 },
  heading: { color: colors.text, fontSize: 20, fontFamily: fonts.semibold },
  body: { color: colors.text, fontSize: 16 },
  dim: { color: colors.textDim, fontSize: 14 },
};

/** Calm backdrop behind the app code keypad, once the vault door has opened. */
export const calm = {
  backgroundColor: '#101214',
  backgroundImage: 'radial-gradient(ellipse 120% 60% at 50% 0%, rgba(255, 206, 140, 0.12) 0%, rgba(16, 18, 20, 0) 70%)',
} as const;
