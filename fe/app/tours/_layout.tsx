import { Stack } from 'expo-router';

export default function ToursLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name='index' />
      <Stack.Screen name='[id]' />
      <Stack.Screen
        name='wizard'
        options={{
          presentation: 'modal',
          title: 'Nuevo Tour',
        }}
      />
    </Stack>
  );
}
