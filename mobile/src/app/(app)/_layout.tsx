import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { takePendingLink } from '@/services/groupLink';
import { onPendingGroup, takePendingGroup } from '@/services/push';
import { PrivacyCover } from '@/ui/PrivacyCover';
import { colors, fonts } from '@/ui/theme';

export default function AppLayout() {
  // A tapped notification: straight to its group once the app is open (the group asks its own code).
  useEffect(() => {
    const go = () => {
      const id = takePendingGroup();
      if (id) router.push({ pathname: '/group/[id]', params: { id } });
    };
    go();
    return onPendingGroup(go);
  }, []);

  // A group invitation tapped while the app was locked (app/+native-intent.tsx): its join screen once
  // the app is open. When it was open, the router went there by itself and the screen took the code.
  useEffect(() => {
    const invite = takePendingLink();
    if (invite) router.navigate({ pathname: '/group/join', params: { invite } });
  }, []);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.accentFg,
        headerTitleStyle: { color: colors.text, fontFamily: fonts.semibold },
        contentStyle: { backgroundColor: colors.bg },
      }}
      // iOS shows modal screens above the root PrivacyCover: each screen carries its own.
      screenLayout={({ children }) => (
        <View style={{ flex: 1 }}>
          {children}
          <PrivacyCover />
        </View>
      )}
    >
      <Stack.Screen name="index" options={{ title: 'BaseSecrète' }} />
      <Stack.Screen name="group/new" options={{ title: 'Nouveau groupe', presentation: 'modal' }} />
      <Stack.Screen name="group/join" options={{ title: 'Rejoindre un groupe', presentation: 'modal' }} />
      <Stack.Screen name="group/direct" options={{ title: 'Ligne privée', presentation: 'modal' }} />
      <Stack.Screen name="group/[id]" options={{ title: '' }} />
      <Stack.Screen name="group/code" options={{ title: 'Changer le code', presentation: 'modal' }} />
      <Stack.Screen name="group/settings" options={{ title: 'Réglages du groupe', presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ title: 'Réglages' }} />
      <Stack.Screen name="biometrics" options={{ title: 'Empreinte', presentation: 'modal' }} />
    </Stack>
  );
}
