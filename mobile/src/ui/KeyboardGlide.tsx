import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Keyboard, Platform, View, type HostInstance, type KeyboardEvent, type StyleProp, type ViewStyle } from 'react-native';

/** Up with the keyboard, as fast as it rises (about 4 frames): the bar must never go under it. */
const UP_MS = 100;
const RISE = Easing.out(Easing.quad);
/** Down after it, slowly: the keyboard drops in a tenth of a second, the bar glides behind it. */
const DOWN_MS = 480;
/** Even slowing down: a sharper curve covers most of the way in two frames and reads as a jump. */
const GLIDE = Easing.out(Easing.quad);

/**
 * Keeps its content above the keyboard, like a KeyboardAvoidingView, but the
 * move is its own: a space under the content, animated. Android gives the
 * keyboard's events no duration (the KeyboardAvoidingView then jumps in one
 * frame); iOS gives the keyboard's own, followed as it comes.
 */
export function KeyboardGlide({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const box = useRef<HostInstance>(null);
  // The box's bottom on screen, measured ahead: at the keyboard's event, a measure would cost a frame.
  const bottom = useRef<number | null>(null);
  const measure = () => box.current?.measureInWindow((_x, y, _w, h) => (bottom.current = y + h));
  const [space] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const move = (to: number, ms: number, easing: (t: number) => number) => {
      space.stopAnimation();
      Animated.timing(space, { toValue: to, duration: ms, easing, useNativeDriver: false }).start();
    };
    const show = (e: KeyboardEvent) => {
      // What the keyboard covers of this box (its bottom may sit above the screen's: safe area).
      const lift = (b: number) => move(Math.max(0, b - e.endCoordinates.screenY), ios && e.duration ? e.duration : UP_MS, RISE);
      if (bottom.current !== null) lift(bottom.current);
      else box.current?.measureInWindow((_x, y, _w, h) => lift(y + h));
    };
    const hide = (e: KeyboardEvent) => move(0, ios && e.duration ? Math.max(e.duration, DOWN_MS) : DOWN_MS, GLIDE);
    const subs = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', show),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', hide),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [space]);

  return (
    <View ref={box} style={style} onLayout={measure}>
      {children}
      <Animated.View style={{ height: space }} />
    </View>
  );
}
