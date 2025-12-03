import React from 'react';
import {
  Box,
  HStack,
  Pressable,
  Icon,
  Text,
  Button,
  ButtonIcon,
} from '@gluestack-ui/themed';
import {
  Home,
  Bookmark,
  Map as MapIcon,
  User,
  Sparkles,
} from 'lucide-react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';

export const BottomTabBar = ({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) => {
  const router = useRouter();

  const handleCreateTour = () => {
    router.push('/tours/wizard');
  };

  return (
    <Box
      position='absolute'
      bottom={0}
      left={0}
      right={0}
      bg='$white'
      pt='$3'
      pb='$8' // Extra padding for bottom safe area
      borderTopWidth={1}
      borderColor='$gray100'
      shadowColor='#000'
      shadowOffset={{ width: 0, height: -2 }}
      shadowOpacity={0.05}
      shadowRadius={10}
      elevation={10}
    >
      <HStack
        justifyContent='space-around'
        alignItems='center'
        position='relative'
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          // Determine icon and label based on route name
          // In Expo Router tabs, route names match the file names (e.g., "index", "saved", "map", "profile")
          let icon = Home;
          let label = 'Inicio';

          if (route.name === 'index') {
            icon = Home;
            label = 'Inicio';
          } else if (route.name === 'saved') {
            icon = Bookmark;
            label = 'Guardados';
          } else if (route.name === 'map') {
            icon = MapIcon;
            label = 'Mapa';
          } else if (route.name === 'profile') {
            icon = User;
            label = 'Perfil';
          }

          return (
            <Pressable
              key={route.key}
              alignItems='center'
              onPress={onPress}
              flex={1}
            >
              <Icon
                as={icon}
                size='xl'
                color={isFocused ? '#2E4038' : '#9CA3AF'}
              />
              <Text
                size='xs'
                mt='$1'
                color={isFocused ? '#2E4038' : '#9CA3AF'}
                fontWeight={isFocused ? '$bold' : '$medium'}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </HStack>

      {/* FAB Button in the center - positioned absolutely over the tab bar */}
      <Box position='absolute' bottom={16} alignSelf='center' zIndex={10}>
        <Button
          onPress={handleCreateTour}
          size='lg'
          borderRadius='$full'
          bg='$primary500'
          width={56}
          height={56}
          shadowColor='#000'
          shadowOffset={{ width: 0, height: 4 }}
          shadowOpacity={0.3}
          shadowRadius={8}
          elevation={8}
        >
          <ButtonIcon as={Sparkles} size='xl' color='$white' />
        </Button>
      </Box>
    </Box>
  );
};
