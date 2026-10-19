import { ArrowLeftRight } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle } from 'react-native';
import { colors, fonts, space } from './theme';

/** Characters in reverse order (code points, so an emoji stays whole). */
export const reversed = (text: string) => Array.from(text).reverse().join('');

/**
 * Password input that shows what is typed backwards instead of dots, so a
 * glance over the shoulder does not read it as is, while the owner can still
 * check it. The ⇄ « Lire » button on the right turns it the right way
 * round, « Envers » back.
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
        hitSlop={8}
        onPress={() => setReadable((r) => !r)}
        style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.6 }]}
      >
        <ArrowLeftRight size={15} color={colors.text} />
        <Text style={styles.toggleText}>{readable ? 'Envers' : 'Lire'}</Text>
      </Pressable>
    </View>
  );
}

const TOGGLE = 82;

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  input: { paddingRight: TOGGLE + space.sm },
  hiddenText: { color: 'transparent' },
  shownText: { color: colors.text },
  overlay: { position: 'absolute', left: 0, right: TOGGLE + space.sm, color: colors.text },
  toggle: {
    position: 'absolute',
    right: space.sm,
    width: TOGGLE - space.sm,
    height: 34,
    borderRadius: 17,
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accentFg,
  },
  toggleText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13 },
});
