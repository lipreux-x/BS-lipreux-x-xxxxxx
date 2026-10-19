import { Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle } from 'react-native';
import { colors, space } from './theme';

/** Characters in reverse order (code points, so an emoji stays whole). */
export const reversed = (text: string) => Array.from(text).reverse().join('');

/**
 * Password input that shows what is typed backwards instead of dots, so a
 * glance over the shoulder does not read it as is, while the owner can still
 * check it. The eye button on the right turns it the right way round.
 *
 * The real value is typed into a field whose text is transparent; the
 * reversed copy is drawn over it. Suggestions and learning are off (the
 * keyboard must not remember the password).
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
        style={[style, styles.input, { marginBottom: 0 }, !readable && styles.hiddenText]}
      />
      {!readable && value ? (
        <Text style={[styles.overlay, { fontSize: flat.fontSize, paddingHorizontal: flat.paddingHorizontal }]} numberOfLines={1} pointerEvents="none">
          {reversed(value)}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={readable ? 'Remettre à l’envers' : 'Lire à l’endroit'}
        hitSlop={8}
        onPress={() => setReadable((r) => !r)}
        style={styles.toggle}
      >
        {readable ? <EyeOff size={20} color={colors.accentFg} /> : <Eye size={20} color={colors.accentFg} />}
      </Pressable>
    </View>
  );
}

const TOGGLE = 44;

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  input: { paddingRight: TOGGLE + space.sm },
  hiddenText: { color: 'transparent' },
  overlay: { position: 'absolute', left: 0, right: TOGGLE + space.sm, color: colors.text },
  toggle: { position: 'absolute', right: space.xs, width: TOGGLE, height: TOGGLE, alignItems: 'center', justifyContent: 'center' },
});
