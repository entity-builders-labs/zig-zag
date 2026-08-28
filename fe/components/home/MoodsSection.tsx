import React, { useState } from "react";
import { ScrollView, Pressable, Box, Text, HStack, Icon } from "@gluestack-ui/themed";
import {
  Sparkles,
  Landmark,
  Trees,
  Coffee,
  Palette,
  Utensils,
  Moon,
  Compass,
} from "lucide-react-native";

export interface MoodItem {
  id: string;
  label: string;
  category: string;
  icon: any;
}

export const MOODS: MoodItem[] = [
  { id: "all", label: "Para ti", category: "all", icon: Sparkles },
  { id: "cafes", label: "Cafés Notables", category: "cafes", icon: Coffee },
  { id: "history", label: "Historia & Cultura", category: "history", icon: Landmark },
  { id: "art", label: "Arte & Murales", category: "art", icon: Palette },
  { id: "food", label: "Gastronomía", category: "food", icon: Utensils },
  { id: "nature", label: "Parques & Aire Libre", category: "nature", icon: Trees },
  { id: "nightlife", label: "Vida Nocturna", category: "nightlife", icon: Moon },
];

interface MoodsSectionProps {
  selectedCategory?: string;
  onSelectCategory?: (category: string) => void;
}

export const MoodsSection: React.FC<MoodsSectionProps> = ({
  selectedCategory = "all",
  onSelectCategory,
}) => {
  const [active, setActive] = useState(selectedCategory);

  const handlePress = (category: string) => {
    setActive(category);
    if (onSelectCategory) {
      onSelectCategory(category);
    }
  };

  return (
    <Box>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
      >
        {MOODS.map((mood) => {
          const isSelected = active === mood.category;
          const IconComp = mood.icon;
          return (
            <Pressable
              key={mood.id}
              onPress={() => handlePress(mood.category)}
            >
              <Box
                flexDirection="row"
                alignItems="center"
                px="$3.5"
                py="$2"
                borderRadius="$full"
                bg={isSelected ? "$primary500" : "$white"}
                borderWidth={1}
                borderColor={isSelected ? "$primary500" : "$borderLight200"}
                shadowColor="$black"
                shadowOffset={{ width: 0, height: 1 }}
                shadowOpacity={isSelected ? 0.15 : 0.03}
                shadowRadius={3}
                elevation={isSelected ? 2 : 1}
              >
                <Icon
                  as={IconComp}
                  size="xs"
                  color={isSelected ? "$white" : "$textLight600"}
                  mr="$1.5"
                />
                <Text
                  size="xs"
                  fontWeight={isSelected ? "$bold" : "$semibold"}
                  color={isSelected ? "$white" : "$textLight800"}
                >
                  {mood.label}
                </Text>
              </Box>
            </Pressable>
          );
        })}
      </ScrollView>
    </Box>
  );
};
