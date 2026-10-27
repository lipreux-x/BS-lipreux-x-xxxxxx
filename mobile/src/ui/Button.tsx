import { Key } from './Key';

/**
 * The full-width key of a form: `primary` is the hot action key, `ghost` a
 * steel key with its label in the cold light (a lesser choice, a tool).
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  busy,
  disabled,
}: {
  title: string;
  onPress(): void;
  variant?: 'primary' | 'ghost';
  busy?: boolean;
  disabled?: boolean;
}) {
  const primary = variant === 'primary';
  return <Key size="lg" label={title} onPress={onPress} variant={primary ? 'hot' : 'steel'} tone={primary ? 'text' : 'cold'} busy={busy} disabled={disabled} />;
}
