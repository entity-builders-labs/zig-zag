import React, { useState, useContext } from "react";
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  ScrollView,
  Pressable,
  Icon,
  Input,
  InputField,
  InputIcon,
  InputSlot,
} from "@gluestack-ui/themed";
import { Search, MapPin, Sparkles, SlidersHorizontal } from "lucide-react-native";
import { MoodsSection } from "@/components/home/MoodsSection";
import { HeroCard } from "@/components/home/HeroCard";
import { RoutesSection } from "@/components/home/RoutesSection";
import { AppContext } from "@/context/app";
import { FONT_DISPLAY } from "@/constants/typography";
import { useRouter } from "expo-router";

export default function HomeScreen() {
  const router = useRouter();
  const { address } = useContext(AppContext);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const locationLabel = address?.label || "Buenos Aires, AR";

  return (
    <Box flex={1} bg="$backgroundLight50">
      <ScrollView
        flex={1}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 110 }}
      >
        <VStack space="xl" pt="$12" pb="$6">
          
          {/* Top Brand & Location Header */}
          <Box px="$4">
            <HStack justifyContent="space-between" alignItems="center">
              <VStack>
                <Heading
                  size="2xl"
                  color="$textLight900"
                  style={{ fontFamily: FONT_DISPLAY, letterSpacing: -0.5 }}
                >
                  Zig-Zag
                </Heading>
                <Text size="xs" color="$textLight500" fontWeight="$medium">
                  Explorá ciudades a tu propio ritmo
                </Text>
              </VStack>

              {/* Location Pill */}
              <Pressable onPress={() => router.push("/(tabs)/map")}>
                <HStack
                  bg="$white"
                  px="$3"
                  py="$1.5"
                  borderRadius="$full"
                  alignItems="center"
                  space="xs"
                  borderWidth={1}
                  borderColor="$borderLight200"
                  shadowColor="$black"
                  shadowOffset={{ width: 0, height: 1 }}
                  shadowOpacity={0.04}
                  shadowRadius={3}
                  elevation={1}
                >
                  <Icon as={MapPin} size="xs" color="$primary600" />
                  <Text size="2xs" fontWeight="$bold" color="$textLight800" numberOfLines={1} maxW={120}>
                    {locationLabel}
                  </Text>
                </HStack>
              </Pressable>
            </HStack>

            {/* Search Bar */}
            <Box mt="$4">
              <HStack
                bg="$white"
                borderRadius="$2xl"
                borderWidth={1}
                borderColor="$borderLight200"
                alignItems="center"
                px="$3.5"
                py="$2"
                shadowColor="$black"
                shadowOffset={{ width: 0, height: 1 }}
                shadowOpacity={0.04}
                shadowRadius={4}
                elevation={1}
              >
                <Icon as={Search} size="sm" color="$textLight400" mr="$2" />
                <Input borderWidth={0} flex={1} h={28} p="$0">
                  <InputField
                    placeholder="Buscar zonas, museos o cafés..."
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    color="$textLight900"
                    fontSize="$sm"
                  />
                </Input>
                <Pressable onPress={() => router.push("/tours/wizard")}>
                  <Box p="$1.5" bg="$primary50" borderRadius="$lg">
                    <Icon as={Sparkles} size="xs" color="$primary600" />
                  </Box>
                </Pressable>
              </HStack>
            </Box>
          </Box>

          {/* Mood / Category Chips */}
          <MoodsSection
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />

          {/* Dynamic Hero Card */}
          <HeroCard />

          {/* Curated / Nearby Routes */}
          <RoutesSection
            category={selectedCategory}
            categoryTitle={
              selectedCategory === "all"
                ? "Rutas recomendadas cerca tuyo"
                : `Rutas de ${selectedCategory}`
            }
          />
        </VStack>
      </ScrollView>
    </Box>
  );
}
