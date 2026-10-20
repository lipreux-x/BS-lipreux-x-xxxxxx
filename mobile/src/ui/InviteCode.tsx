import { Fragment, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { INVITE_LENGTH, nextInvite } from './invite';
import { Led } from './Led';
import { colors, mono } from './theme';

/**
 * Invitation code typed on the safe's backlit screen, same as the app code
 * display: 16 slots in groups of 4, the dashes printed on the screen (never
 * typed: a typed dash is ignored), the next slot lit while the field has
 * focus. Status LED off while it is incomplete, green once the 16 characters
 * are there, red when the server refused it.
 *
 * The real text field (letters and digits only, so the cursor always stays
 * at the end) lies over the screen, see-through (Android drew its text in
 * black despite a transparent color, so it is fully hidden there; iOS needs
 * it visible to take taps, so only its text is): tapping opens the keyboard, a long
 * press pastes. On Android, no suggestions: the word being composed is not
 * drawn either.
 */
export function InviteCodeInput({ value, onChange, error }: { value: string; onChange(code: string): void; error?: boolean }) {
  const [focused, setFocused] = useState(false);
  const complete = value.length === INVITE_LENGTH;
  return (
    <View style={styles.bezel}>
      <View style={styles.screen}>
        <Text style={styles.chars} numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: INVITE_LENGTH }, (_, i) => {
            const typed = i < value.length;
            const next = focused && i === value.length;
            return (
              <Fragment key={i}>
                {i > 0 && i % 4 === 0 ? <Text style={styles.off}>-</Text> : null}
                <Text style={typed ? (error ? styles.errorChars : styles.on) : next ? styles.on : styles.off}>
                  {typed ? value[i] : next ? '_' : '·'}
                </Text>
              </Fragment>
            );
          })}
        </Text>
        <TextInput
          value={value}
          onChangeText={(t) => onChange(nextInvite(value, t))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
          caretHidden
          selectionColor="transparent"
          accessibilityLabel="Code d’invitation"
          style={styles.input}
        />
      </View>
      <Led state={error ? 'red' : complete ? 'green' : 'off'} size={10} />
    </View>
  );
}

/** A created invitation, shown on the same screen; green LED: ready to give. */
export function InviteCodeDisplay({ code }: { code: string }) {
  return (
    <View style={styles.bezel}>
      <View style={styles.screen}>
        <Text selectable style={[styles.chars, styles.on]} numberOfLines={1} adjustsFontSizeToFit>
          {code}
        </Text>
      </View>
      <Led state="green" size={10} />
    </View>
  );
}

const LCD_ON = '#C8D3C0';
const LCD_OFF = '#2C3830';

const styles = StyleSheet.create({
  bezel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    paddingRight: 14,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderTopColor: '#3A3A3A',
    borderLeftColor: '#3A3A3A',
    borderBottomColor: '#050505',
    borderRightColor: '#050505',
  },
  screen: {
    flex: 1,
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 4,
    backgroundColor: '#0B100C',
    borderWidth: 2,
    borderTopColor: '#000000',
    borderLeftColor: '#000000',
    borderBottomColor: colors.border,
    borderRightColor: colors.border,
  },
  chars: { fontFamily: mono, fontSize: 18, letterSpacing: 1, textAlign: 'center' },
  // Over the whole screen, invisible: it only takes the taps and the keyboard.
  // iOS skips views under 1% opacity when it looks for what was tapped (the
  // keyboard never opened), so there only the text is transparent.
  input: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: 0,
    opacity: Platform.OS === 'android' ? 0 : 1,
    color: 'transparent',
    fontSize: 18,
  },
  off: { color: LCD_OFF },
  on: { color: LCD_ON, textShadowColor: LCD_ON, textShadowRadius: 6 },
  errorChars: { color: colors.danger, textShadowColor: colors.danger, textShadowRadius: 6 },
});
