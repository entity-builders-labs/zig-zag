import React, { useEffect, useState } from "react";
import {
  VStack,
  Heading,
  ScrollView,
  Box,
  HStack,
  Image,
  Icon,
  Text,
  Spinner,
  Pressable,
} from "@gluestack-ui/themed";
import { MapPin, ChevronRight, Clock, Footprints, Sparkles, Wand2 } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useMap } from "@/context/app";
import { fetchNearbyTours, fetchMyTours, Tour } from "@/api/tours";
import { FONT_DISPLAY } from "@/constants/typography";

interface TourItem extends Partial<Tour> {
  id?: string;
  name: string;
  duration?: number;
  coverImage?: string;
  stopsCount?: number;
  categoryTag?: string;
  distanceKm?: string;
  destination?: string;
  category?: string;
  isTemplate?: boolean;
}

const INSPIRATION_TEMPLATES: TourItem[] = [
  {
    name: "Joyas Ocultas de San Telmo",
    destination: "San Telmo, Buenos Aires",
    category: "history",
    categoryTag: "Historia & Bohemio",
    duration: 2.2,
    coverImage: "https://images.unsplash.com/photo-1589909202802-8f4aadce1849?q=80&w=600&auto=format&fit=crop",
    stopsCount: 4,
    distanceKm: "1.9 km",
    isTemplate: true,
  },
  {
    name: "Ruta de Cafés Notables & Literatura",
    destination: "Avenida de Mayo, Buenos Aires",
    category: "cafes",
    categoryTag: "Cafés",
    duration: 1.8,
    coverImage: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=600&auto=format&fit=crop",
    stopsCount: 3,
    distanceKm: "1.4 km",
    isTemplate: true,
  },
  {
    name: "Palermo Soho: Murales & Diseño",
    destination: "Palermo Soho, Buenos Aires",
    category: "art",
    categoryTag: "Arte Urbano",
    duration: 2.5,
    coverImage: "https://images.unsplash.com/photo-1497935586351-b67a49e012bf?q=80&w=600&auto=format&fit=crop",
    stopsCount: 5,
    distanceKm: "2.3 km",
    isTemplate: true,
  },
  {
    name: "Arquitectura Clásica de Recoleta",
    destination: "Recoleta, Buenos Aires",
    category: "architecture",
    categoryTag: "Arquitectura",
    duration: 3.0,
    coverImage: "https://images.unsplash.com/photo-1569336415962-a4bd9f69cd83?q=80&w=600&auto=format&fit=crop",
    stopsCount: 4,
    distanceKm: "2.6 km",
    isTemplate: true,
  },
];

interface RoutesSectionProps {
  category?: string;
  categoryTitle?: string;
}

export const RoutesSection = ({
  category = "walking",
  categoryTitle = "Rutas recomendadas",
}: RoutesSectionProps) => {
  const router = useRouter();
  const { center } = useMap();
  const [tours, setTours] = useState<TourItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadTours = async () => {
      setLoading(true);
      try {
        let fetched: Tour[] = [];
        if (center?.lat && center?.lng) {
          fetched = await fetchNearbyTours(
            center.lat,
            center.lng,
            category === "all" ? "walking" : category,
            5000
          );
        }

        // If no nearby tours, check user's existing tours
        if (!fetched || fetched.length === 0) {
          const myToursRes = await fetchMyTours().catch(() => ({ tours: [] }));
          if (myToursRes?.tours && myToursRes.tours.length > 0) {
            fetched = myToursRes.tours;
          }
        }

        if (isMounted) {
          if (fetched && fetched.length > 0) {
            setTours(fetched);
          } else {
            setTours(INSPIRATION_TEMPLATES);
          }
        }
      } catch (error) {
        if (isMounted) {
          setTours(INSPIRATION_TEMPLATES);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadTours();
    return () => {
      isMounted = false;
    };
  }, [center, category]);

  const displayTours = tours.length > 0 ? tours : INSPIRATION_TEMPLATES;

  const getTourImage = (tour: any, index: number) => {
    if (tour.coverImage) return tour.coverImage;
    if (tour.activities?.[0]?.activity?.photos?.[0]) {
      const p = tour.activities[0].activity.photos[0];
      return typeof p === "string" ? p : p.url;
    }
    return INSPIRATION_TEMPLATES[index % INSPIRATION_TEMPLATES.length].coverImage;
  };

  const getDurationString = (tour: any) => {
    const d = tour.duration || 2;
    const hours = Math.floor(d);
    const mins = Math.round((d - hours) * 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const handleTourPress = (tour: TourItem) => {
    if (
      tour.isTemplate ||
      !tour.id ||
      tour.id.startsWith("template-") ||
      tour.id.startsWith("tour-")
    ) {
      router.push({
        pathname: "/tours/wizard",
        params: {
          destination: tour.destination || tour.name,
          category: tour.category || "walking",
        },
      });
    } else {
      router.push(`/tours/${tour.id}`);
    }
  };

  return (
    <VStack space="md" mt="$2">
      <HStack
        px="$4"
        justifyContent="space-between"
        alignItems="center"
        w="$full"
      >
        <VStack>
          <Heading
            size="md"
            color="$textLight900"
            style={{ fontFamily: FONT_DISPLAY }}
          >
            {categoryTitle}
          </Heading>
          <Text size="2xs" color="$textLight500">
            Itinerarios curados para caminar y descubrir
          </Text>
        </VStack>

        <Pressable onPress={() => router.push("/tours")}>
          <HStack space="xs" alignItems="center">
            <Text size="xs" color="$primary600" fontWeight="$bold">
              Ver todos
            </Text>
            <Icon as={ChevronRight} size="2xs" color="$primary600" />
          </HStack>
        </Pressable>
      </HStack>

      {loading ? (
        <Box h={220} justifyContent="center" alignItems="center">
          <Spinner size="large" color="$primary500" />
        </Box>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 14, paddingHorizontal: 16 }}
        >
          {displayTours.map((tour: any, index: number) => {
            const imgUrl = getTourImage(tour, index);
            const stops = tour.activities?.length || tour.stopsCount || 4;
            const tag = tour.categoryTag || "Ruta a pie";
            const isTemplate = tour.isTemplate || !tour.id || tour.id.startsWith("tour-");

            return (
              <Pressable
                key={tour.id || index}
                onPress={() => handleTourPress(tour)}
              >
                <Box
                  w={270}
                  bg="$white"
                  borderRadius="$2xl"
                  overflow="hidden"
                  borderWidth={1}
                  borderColor="$borderLight200"
                  shadowColor="$black"
                  shadowOffset={{ width: 0, height: 2 }}
                  shadowOpacity={0.06}
                  shadowRadius={8}
                  elevation={2}
                >
                  {/* Card Cover */}
                  <Box h={150} position="relative" bg="$backgroundLight200">
                    <Image
                      source={{ uri: imgUrl }}
                      alt={tour.name}
                      w="$full"
                      h="$full"
                      resizeMode="cover"
                    />

                    {/* Gradient overlay */}
                    <Box
                      position="absolute"
                      top={0}
                      left={0}
                      right={0}
                      bottom={0}
                      bg="$black"
                      opacity={0.25}
                    />

                    {/* Category Tag on Top Left */}
                    <Box position="absolute" top={10} left={10}>
                      <Box
                        bg="rgba(0, 0, 0, 0.65)"
                        px="$2.5"
                        py="$1"
                        borderRadius="$full"
                      >
                        <Text size="2xs" fontWeight="$bold" color="$white">
                          {tag}
                        </Text>
                      </Box>
                    </Box>

                    {/* Template Badge or Duration badge on Bottom */}
                    {isTemplate ? (
                      <Box position="absolute" bottom={10} right={10}>
                        <HStack
                          bg="$primary500"
                          px="$2.5"
                          py="$1"
                          borderRadius="$full"
                          alignItems="center"
                          space="xs"
                        >
                          <Icon as={Wand2} size="2xs" color="$white" />
                          <Text size="2xs" fontWeight="$bold" color="$white">
                            Crear Tour
                          </Text>
                        </HStack>
                      </Box>
                    ) : (
                      <Box position="absolute" bottom={10} right={10}>
                        <HStack
                          bg="rgba(255, 255, 255, 0.95)"
                          px="$2"
                          py="$0.5"
                          borderRadius="$full"
                          alignItems="center"
                          space="xs"
                        >
                          <Icon as={Clock} size="2xs" color="$textLight700" />
                          <Text size="2xs" fontWeight="$bold" color="$textLight900">
                            {getDurationString(tour)}
                          </Text>
                        </HStack>
                      </Box>
                    )}
                  </Box>

                  {/* Card Details */}
                  <VStack p="$3.5" space="xs">
                    <Heading
                      size="sm"
                      color="$textLight900"
                      numberOfLines={1}
                      style={{ fontFamily: FONT_DISPLAY }}
                    >
                      {tour.name}
                    </Heading>

                    <HStack space="md" alignItems="center" mt="$1">
                      <HStack space="xs" alignItems="center">
                        <Icon as={MapPin} size="2xs" color="$primary600" />
                        <Text size="xs" color="$textLight600" fontWeight="$medium">
                          {stops} paradas
                        </Text>
                      </HStack>
                      <Text size="xs" color="$textLight400">•</Text>
                      <HStack space="xs" alignItems="center">
                        <Icon as={Footprints} size="2xs" color="$textLight500" />
                        <Text size="xs" color="$textLight500">
                          {tour.distanceKm || "2.1 km"}
                        </Text>
                      </HStack>
                    </HStack>
                  </VStack>
                </Box>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </VStack>
  );
};
