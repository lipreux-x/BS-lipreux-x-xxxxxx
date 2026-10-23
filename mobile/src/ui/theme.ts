import { Platform } from 'react-native';

/*
 * SPEC §8, "la lame": a black vault whose steel stays dark and neutral, lit by
 * two lights. The cold one, sky blue, is the light of information: the LCD
 * screens' backlight, strokes and links, "open" and "ok". The hot one, neon
 * red, is the light of action: the send key, "open the safe", the portal,
 * alerts and what is waiting for you. Pale filaments (#EAFCFF) are the
 * glints: a working LED, the sheen on the door.
 *
 * To try the other direction (terminal green instead of red), only `blade`
 * and the derived tokens below change: nothing else in the app names a hue.
 */

/** The charte's six colours, as given. */
export const blade = {
  skyLight: '#7FE6FF', // the blade's upper tip
  sky: '#4FC3FF', // upper blade
  rose: '#FF5A78', // transition
  neon: '#FF3B4E', // lower blade and point
  filament: '#EAFCFF', // light threads, at ~55 % opacity
  black: '#000000',
} as const;

export const colors = {
  bg: blade.black,
  surface: '#0A0D10',
  surface2: '#161B20',
  border: '#262D34',
  text: '#FFFFFF',
  textDim: '#8A95A0',
  /** Cold fills (my messages, a selected option): sky steel. White text on it: 14:1. */
  accent: '#0E2E42',
  /** Cold strokes and text on black (links, header tint, icons): 10.6:1. */
  accentFg: blade.sky,
  /** Hot fills: the action keys (send, open, confirm). White text on it: 9:1. */
  primary: '#8E1B2A',
  /** The hot light itself, on black: 6:1. Also what cannot be undone. */
  danger: blade.neon,
  /** The hot light, softer: edges of the action keys, "Secrète" in the wordmark (7:1). */
  hot: blade.rose,
  /** Filament light at its ~55 %: hairlines, glints. */
  filament: 'rgba(234, 252, 255, 0.55)',
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

/**
 * Status LEDs, as on the safe's code display: dark when off, a pale filament
 * while something is being done, sky blue when it is right or open, neon red
 * on an error or something shut.
 */
export const led = { off: '#1A2026', busy: blade.filament, ok: blade.sky, error: blade.neon } as const;

/** The safe's backlit LCD screens: dark blue glass, sky-blue characters, and the unlit ones barely there. */
export const lcd = {
  glass: '#060B10',
  on: blade.skyLight,
  off: '#17303D',
  /** The whole display lit at once (a code accepted). */
  flash: blade.filament,
} as const;

/**
 * Brushed steel of the safe: keys, plates, bezels. Light comes from the top
 * left: a key is lit on its upper-left edges and dark below; pressed, the
 * bevel inverts. Recessed screens are the other way round (dark on top).
 */
export const steel = {
  /** Keypad keys and small round keys. */
  key: '#22272C',
  keyPressed: '#191D21',
  /** Message plates, avatar rings, chips. */
  plate: '#1B1F24',
  edgeLight: '#485058',
  edgeDark: '#090A0C',
  /** Lit edge of the panels and plates (the keypad's, a dialog's). */
  panelEdge: '#2A2F34',
  /** Lit edge of a display's bezel, and its dark one. */
  bezelLight: '#363C42',
  bezelDark: '#050607',
  screw: '#3A4046',
  engraving: '#5B6670',
} as const;

/** The hot action keys: the blade's red, lit on its upper edges in rose, dark crimson below. */
export const hotKey = {
  face: colors.primary,
  facePressed: '#6A1420',
  edgeLight: blade.rose,
  edgeDark: '#4A0E14',
} as const;

/** A destructive key: near-black red with the neon edge; the hot light, held back. */
export const dangerKey = { face: '#3A0B10', edge: blade.neon } as const;

/** My message plates: sky steel, lit on the upper edges in a paler blue. */
export const coldPlate = { edgeLight: '#2F6E94', edgeDark: '#071A26' } as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 } as const;

export const type = {
  title: { color: colors.text, fontSize: 28, fontFamily: fonts.bold, letterSpacing: 0.5 },
  heading: { color: colors.text, fontSize: 20, fontFamily: fonts.semibold },
  body: { color: colors.text, fontSize: 16 },
  dim: { color: colors.textDim, fontSize: 14 },
};

/**
 * Calm backdrop behind the app code keypad, once through the vault's portal:
 * black, with a faint sky-blue glow left at the top (the blade's upper tip)
 * and the red of its point barely rising from the bottom.
 */
export const calm = {
  backgroundColor: '#05080C',
  backgroundImage:
    'radial-gradient(ellipse 120% 60% at 50% 0%, rgba(79, 195, 255, 0.10) 0%, rgba(5, 8, 12, 0) 70%), radial-gradient(ellipse 100% 40% at 50% 100%, rgba(255, 59, 78, 0.07) 0%, rgba(5, 8, 12, 0) 70%)',
} as const;
