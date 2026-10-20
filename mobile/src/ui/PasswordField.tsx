import { ArrowLeftRight } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle } from 'react-native';
import { colors, space } from './theme';

/** Characters in reverse order (code points, so an emoji stays whole). */
export const reversed = (text: string) => Array.from(text).reverse().join('');

/**
 * Password input that shows what is typed backwards instead of dots, so a
 * glance over the shoulder does not read it as is, while the owner can still
 * check it. The ⇄ key on the right (a small keypad key, lit while the
 * text reads the right way round) switches between the two.
 *
 * The real value is typed into a field whose text is transparent; the
 * reversed copy is drawn over it. The field is created again at each switch:
 * Android does not repaint text whose color goes from transparent to
 * visible. Suggestions and learning are off (the keyboard must not remember
 * the password).
 */
export function PasswordField({
  value,
  onChangeText,
  placeholder,
  textContentType,
  style,
}: {
  value: string;
  onChangeText(text: string): void;
  placeholder?: string;
  textContentType: 'password' | 'newPassword';
  style?: StyleProp<TextStyle>;
}) {
  const [readable, setReadable] = useState(false);
  const flat = StyleSheet.flatten(style) ?? {};
  return (
    <View style={[styles.wrap, { marginBottom: flat.marginBottom }]}>
      <TextInput
        key={readable ? 'readable' : 'reversed'}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete={textContentType === 'password' ? 'current-password' : 'new-password'}
        textContentType={textContentType}
        // Android: no suggestions, nothing learned from what is typed.
        keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
        contextMenuHidden={!readable}
        caretHidden={!readable}
        style={[style, styles.input, { marginBottom: 0 }, readable ? styles.shownText : styles.hiddenText]}
      />
      {!readable && value ? (
        <Text style={[styles.overlay, { fontSize: flat.fontSize, paddingHorizontal: flat.paddingHorizontal }]} numberOfLines={1} pointerEvents="none">
          {reversed(value)}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={readable ? 'Remettre le mot de passe à l’envers' : 'Lire le mot de passe à l’endroit'}
        accessibilityState={{ selected: readable }}
        hitSlop={8}
        onPress={() => setReadable((r) => !r)}
        style={({ pressed }) => [styles.key, readable && styles.keyOn, pressed && styles.pressed]}
      >
        <ArrowLeftRight size={18} strokeWidth={2.2} color={readable ? colors.text : colors.accentFg} />
      </Pressable>
    </View>
  );
}

const KEY = 38;
const METAL = '#24282B';
const LIGHT_EDGE = '#4A5056';
const DARK_EDGE = '#0A0B0C';

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  input: { paddingRight: KEY + space.sm * 2 },
  hiddenText: { color: 'transparent' },
  shownText: { color: colors.text },
  overlay: { position: 'absolute', left: 0, right: KEY + space.sm * 2, color: colors.text },
  // Same bevelled metal as the keypad keys.
  key: {
    position: 'absolute',
    right: space.sm,
    width: KEY,
    height: KEY,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: METAL,
    borderWidth: 1,
    borderTopColor: LIGHT_EDGE,
    borderLeftColor: LIGHT_EDGE,
    borderBottomColor: DARK_EDGE,
    borderRightColor: DARK_EDGE,
  },
  keyOn: { backgroundColor: colors.accent },
  // Pressed: the bevel inverts, the key looks pushed in.
  pressed: {
    backgroundColor: '#1B1E20',
    borderTopColor: DARK_EDGE,
    borderLeftColor: DARK_EDGE,
    borderBottomColor: LIGHT_EDGE,
    borderRightColor: LIGHT_EDGE,
    transform: [{ translateY: 1 }],
  },
});
