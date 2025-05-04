import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { SafeAreaView } from 'react-native-safe-area-context';

export type RootStackParamList = {
  Home: undefined;
  Profile: undefined;
  Tours: undefined;
};

// stack navigator s
const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Stack.Navigator>
        <Stack.Screen
          name='Home'
          component={HomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen name='Profile' component={ProfileScreen} />
      </Stack.Navigator>
    </SafeAreaView>
  );
}
