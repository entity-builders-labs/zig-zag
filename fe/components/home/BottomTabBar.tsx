import React from 'react';
import { Box, HStack, Pressable, Icon, Text } from '@gluestack-ui/themed';
import { Home, Bookmark, Map as MapIcon, User } from 'lucide-react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';

export const BottomTabBar = ({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) => {
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
      <HStack justifyContent='space-around' alignItems='center'>
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
            <Pressable key={route.key} alignItems='center' onPress={onPress}>
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
    </Box>
  );
};
