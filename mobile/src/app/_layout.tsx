import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  useFonts,
} from '@expo-google-fonts/space-grotesk';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import { SessionProvider, useSession } from '@/session/SessionProvider';
import { Button } from '@/ui/Button';
import { PrivacyCover } from '@/ui/PrivacyCover';
import { Working } from '@/ui/Working';
import { colors, fonts, space, type } from '@/ui/theme';

/** The server no longer knows this account: erase the phone (or try again, for a server that answered wrong). */
function AccountGone({ username, retry }: { username: string; retry(): void }) {
  const { forgetAccount } = useSession();
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: space.lg, gap: space.md }}>
      <Text style={type.heading}>Ce compte n’existe plus</Text>
      <Text style={type.dim}>
        Le serveur ne connaît plus « {username} » : le compte a été supprimé, depuis ce téléphone ou un autre. Les clés gardées ici n’ouvrent plus aucun
        coffre. Efface-les pour créer un nouveau compte ou te reconnecter avec un autre.
      </Text>
      <Button
        title="Effacer ce téléphone"
        busy={busy}
        onPress={() => {
          setBusy(true);
          void forgetAccount().catch(() => setBusy(false));
        }}
      />
      <Button title="Réessayer" variant="ghost" disabled={busy} onPress={retry} />
    </View>
  );
}

function RootStack() {
  const { status } = useSession();
  // A font that fails to load falls back to the system one: never block the app on it.
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });
  if (status.kind === 'failed') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: space.lg, gap: space.md }}>
        <Text style={type.heading}>L’app n’a pas pu démarrer</Text>
        <Text style={type.dim}>Une erreur est survenue à l’ouverture du coffre. Réessaie, ou redémarre le téléphone.</Text>
        <Button title="Réessayer" onPress={status.retry} />
      </View>
    );
  }
  if (status.kind === 'gone') return <AccountGone username={status.username} retry={status.retry} />;
  if (status.kind === 'loading' || (!fontsLoaded && !fontError)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Working />
      </View>
    );
  }
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.accentFg,
        headerTitleStyle: { color: colors.text, fontFamily: fonts.semibold },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={status.kind === 'no-account'}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={status.kind === 'locked'}>
        {/* No fade: the screen being locked must not show through on the way in. */}
        <Stack.Screen name="lock" options={{ headerShown: false, animation: 'none' }} />
      </Stack.Protected>
      <Stack.Protected guard={status.kind === 'unlocked'}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <RootStack />
      <PrivacyCover />
    </SessionProvider>
  );
}
