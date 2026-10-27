import { ArrowLeftRight } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Key } from './Key';
import { fieldStyles, PROMPT, Screen } from './Screen';
import { blade, colors, steel } from './theme';

/** Characters in reverse order (code points, so an emoji stays whole). */
export const reversed = (text: string) => Array.from(text).reverse().join('');

/**
 * Password field, on the same recessed screen as the other fields, that
 * shows what is typed backwards instead of dots, so a glance over the
 * shoulder does not read it as is, while the owner can still check it. The
 * arrows key on the right (a small keypad key, a cold plate while the text
 * reads the right way round) switches between the two.
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
}: {
  value: string;
  onChangeText(text: string): void;
  placeholder?: string;
  textContentType: 'password' | 'newPassword';
}) {
  const [readable, setReadable] = useState(false);
  return (
    <Screen style={fieldStyles.row}>
      <Text style={fieldStyles.prompt} accessibilityElementsHidden importantForAccessibility="no">
        {PROMPT}
      </Text>
      <View style={styles.well}>
        <TextInput
          key={readable ? 'readable' : 'reversed'}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={steel.engraving}
          selectionColor={blade.sky}
          cursorColor={blade.sky}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete={textContentType === 'password' ? 'current-password' : 'new-password'}
          textContentType={textContentType}
          // Android: no suggestions, nothing learned from what is typed.
          keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
          contextMenuHidden={!readable}
          caretHidden={!readable}
          style={[fieldStyles.input, readable ? styles.shownText : styles.hiddenText]}
        />
        {!readable && value ? (
          <Text style={[fieldStyles.input, styles.overlay]} numberOfLines={1} pointerEvents="none">
            {reversed(value)}
          </Text>
        ) : null}
      </View>
      <Key
        size="sm"
        square
        accessibilityLabel={readable ? 'Remettre le mot de passe à l’envers' : 'Lire le mot de passe à l’endroit'}
        hitSlop={8}
        onPress={() => setReadable((r) => !r)}
        style={readable && styles.keyOn}
      >
        <ArrowLeftRight size={18} strokeWidth={2.2} color={readable ? colors.text : colors.accentFg} />
      </Key>
    </Screen>
  );
}

const styles = StyleSheet.create({
  well: { flex: 1, justifyContent: 'center' },
  hiddenText: { color: 'transparent' },
  shownText: { color: colors.text },
  overlay: { position: 'absolute', left: 0, right: 0, flex: 0, color: colors.text },
  keyOn: { backgroundColor: colors.accent },
});
