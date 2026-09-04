import { Stack } from 'expo-router';

export default function ExperiencesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name='[id]' />
    </Stack>
  );
}
