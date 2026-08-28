import React from "react";
import {
  Box,
  HStack,
  Pressable,
  Icon,
  Text,
} from "@gluestack-ui/themed";
import {
  Home,
  Bookmark,
  MapPin,
  Compass,
  User,
  Sparkles,
} from "lucide-react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useRouter } from "expo-router";

export const BottomTabBar = ({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) => {
  const router = useRouter();

  const handleCreateTour = () => {
    router.push("/tours/wizard");
  };

  // Find routes
  const homeRoute = state.routes.find((r) => r.name === "index");
  const savedRoute = state.routes.find((r) => r.name === "saved");
  const mapRoute = state.routes.find((r) => r.name === "map");
  const profileRoute = state.routes.find((r) => r.name === "profile");

  const renderTabItem = (route: typeof homeRoute, defaultIcon: any, label: string) => {
    if (!route) return null;
    const index = state.routes.indexOf(route);
    const isFocused = state.index === index;

    const onPress = () => {
      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });

      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(route.name, route.params);
      }
    };

    return (
      <Pressable
        testID={`tab-${route.name}`}
        alignItems="center"
        justifyContent="center"
        onPress={onPress}
        flex={1}
        py="$1"
      >
        <Box alignItems="center">
          <Icon
            as={defaultIcon}
            size="md"
            color={isFocused ? "$primary600" : "$textLight400"}
          />
          <Text
            size="2xs"
            mt="$1"
            color={isFocused ? "$primary600" : "$textLight400"}
            fontWeight={isFocused ? "$bold" : "$semibold"}
          >
            {label}
          </Text>
          {isFocused && (
            <Box
              w={4}
              h={4}
              borderRadius="$full"
              bg="$primary600"
              mt="$0.5"
            />
          )}
        </Box>
      </Pressable>
    );
  };

  return (
    <Box
      position="absolute"
      bottom={0}
      left={0}
      right={0}
      bg="$white"
      pt="$2.5"
      pb="$6"
      borderTopWidth={1}
      borderColor="$borderLight100"
      shadowColor="$black"
      shadowOffset={{ width: 0, height: -4 }}
      shadowOpacity={0.06}
      shadowRadius={12}
      elevation={12}
    >
      <HStack
        justifyContent="space-between"
        alignItems="center"
        px="$2"
      >
        {/* Left Tabs */}
        {renderTabItem(homeRoute, Home, "Inicio")}
        {renderTabItem(savedRoute, Bookmark, "Guardados")}

        {/* Center Prominent FAB */}
        <Box flex={1} alignItems="center" justifyContent="center">
          <Pressable
            onPress={handleCreateTour}
            testID="create-tour-fab"
            style={{ marginTop: -24 }}
          >
            <Box
              w={54}
              h={54}
              borderRadius="$full"
              bg="$primary500"
              alignItems="center"
              justifyContent="center"
              borderWidth={3}
              borderColor="$white"
              shadowColor="$primary500"
              shadowOffset={{ width: 0, height: 4 }}
              shadowOpacity={0.4}
              shadowRadius={8}
              elevation={8}
            >
              <Icon as={Sparkles} size="lg" color="$white" />
            </Box>
          </Pressable>
          <Text
            size="2xs"
            mt="$1"
            color="$primary600"
            fontWeight="$bold"
          >
            Crear
          </Text>
        </Box>

        {/* Right Tabs */}
        {renderTabItem(mapRoute, Compass, "Mapa")}
        {renderTabItem(profileRoute, User, "Perfil")}
      </HStack>
    </Box>
  );
};
