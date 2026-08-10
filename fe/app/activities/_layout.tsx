import { Stack } from 'expo-router';

export default function ActivitiesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name='[id]' />
    </Stack>
  );
}
