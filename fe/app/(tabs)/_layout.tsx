import { Tabs } from 'expo-router';
import { BottomTabBar } from '@/components/home/BottomTabBar';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <BottomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name='index'
        options={{
          title: 'Inicio',
        }}
      />
      <Tabs.Screen
        name='saved'
        options={{
          title: 'Guardados',
        }}
      />
      <Tabs.Screen
        name='map'
        options={{
          title: 'Mapa',
        }}
      />
      <Tabs.Screen
        name='profile'
        options={{
          title: 'Perfil',
        }}
      />
    </Tabs>
  );
}
