import { forwardRef, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { bevel, blade, colors, lcd, mono, steel } from './theme';

/**
 * The style of a recessed screen of the safe: dark blue glass, the bevel
 * inverted (dark on top, as the light comes from above). For views that
 * build their own screen (a chip, a counter).
 */
export const screenStyle = {
  borderRadius: 8,
  backgroundColor: lcd.glass,
  borderWidth: 2,
  ...bevel(blade.black, colors.border, true),
} as const;

/** A recessed screen: anything the safe displays or takes in sits on one. */
export function Screen({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return <View style={[screenStyle, style]}>{children}</View>;
}

export const FIELD_H = 52;
/** The prompt before anything typed, as at a terminal. */
export const PROMPT = '❯';

/** Shared by `Field` and the password field: the row on the screen, its prompt, what is typed. */
export const fieldStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: FIELD_H, paddingLeft: 12, paddingRight: 7, gap: 8 },
  prompt: { fontFamily: mono, fontSize: 15, color: colors.accentFg },
  input: { flex: 1, color: colors.text, fontFamily: mono, fontSize: 16, paddingVertical: 12, paddingHorizontal: 0 },
});

/**
 * A text field of the app: typed at a prompt on a recessed screen, in the
 * terminal's font, the cold light for the cursor. `right`: a key or a LED at
 * the end of the row.
 */
export const Field = forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps & { right?: ReactNode; containerStyle?: StyleProp<ViewStyle> }>(
  function Field({ right, containerStyle, style, ...input }, ref) {
    return (
      <Screen style={[fieldStyles.row, containerStyle]}>
        <Text style={fieldStyles.prompt} accessibilityElementsHidden importantForAccessibility="no">
          {PROMPT}
        </Text>
        <TextInput
          ref={ref}
          placeholderTextColor={steel.engraving}
          selectionColor={blade.sky}
          cursorColor={blade.sky}
          {...input}
          style={[fieldStyles.input, style]}
        />
        {right}
      </Screen>
    );
  },
);
