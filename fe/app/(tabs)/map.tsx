import React, { useState, useEffect, useContext, useMemo } from "react";
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Pressable,
  Icon,
  Input,
  InputField,
  Spinner,
  ScrollView,
  Image,
  Button,
  ButtonText,
} from "@gluestack-ui/themed";
import {
  Search,
  MapPin,
  Compass,
  Crosshair,
  Sparkles,
  Star,
  X,
  ChevronRight,
  Coffee,
  Landmark,
  Utensils,
  Palette,
  Trees,
  Eye,
} from "lucide-react-native";
import { Map } from "@/features/map";
import { Marker } from "@/features/map/types";
import { AppContext, useMap } from "@/context/app";
import { fetchNearbyExperiences } from "@/api/experiences";
import { FONT_DISPLAY } from "@/constants/typography";
import { requestAndGetCurrentLocation } from "@/utils/location";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface MapPlace {
  id: string;
  name: string;
  description: string;
  type: string;
  categoryLabel: string;
  categoryIcon: any;
  /** Unknown for a real backend Experience with no quality signal yet --
   * never a fabricated placeholder value. Absent means "no rating to show". */
  rating?: number;
  ratingCount?: number;
  latitude: number;
  longitude: number;
  address: string;
  photoUrl: string;
}

const CURATED_PLACES: MapPlace[] = [
  {
    id: "place-1",
    name: "Teatro Colón",
    description: "Uno de los teatros de ópera con mejor acústica del mundo e imponente arquitectura.",
    type: "culture",
    categoryLabel: "Cultura",
    categoryIcon: Landmark,
    rating: 4.9,
    ratingCount: 3800,
    latitude: -34.6011,
    longitude: -58.3831,
    address: "Cerrito 628, San Nicolás",
    photoUrl: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: "place-2",
    name: "Palacio Barolo",
    description: "Rascacielos histórico inspirado en la Divina Comedia con faro panorámico sobre la ciudad.",
    type: "architecture",
    categoryLabel: "Arquitectura",
    categoryIcon: Landmark,
    rating: 4.8,
    ratingCount: 2150,
    latitude: -34.6094,
    longitude: -58.3858,
    address: "Av. de Mayo 1370, Montserrat",
    photoUrl: "https://images.unsplash.com/photo-1589909202802-8f4aadce1849?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: "place-3",
    name: "Café Tortoni",
    description: "El café más antiguo y emblemático de Buenos Aires, cuna de intelectuales y tango.",
    type: "cafes",
    categoryLabel: "Café Notable",
    categoryIcon: Coffee,
    rating: 4.7,
    ratingCount: 5200,
    latitude: -34.6083,
    longitude: -58.3792,
    address: "Av. de Mayo 825, Montserrat",
    photoUrl: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: "place-4",
    name: "Museo Nacional de Bellas Artes",
    description: "Colección invaluable de arte internacional y argentino en el corazón de Recoleta.",
    type: "art",
    categoryLabel: "Arte",
    categoryIcon: Palette,
    rating: 4.8,
    ratingCount: 2900,
    latitude: -34.5841,
    longitude: -58.3927,
    address: "Av. del Libertador 1473, Recoleta",
    photoUrl: "https://images.unsplash.com/photo-1569336415962-a4bd9f69cd83?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: "place-5",
    name: "Plaza Dorrego & Mercado",
    description: "Epicentro bohemio de San Telmo con bares clásicos, antigüedades y artistas callejeros.",
    type: "history",
    categoryLabel: "Historia & Bohemio",
    categoryIcon: Landmark,
    rating: 4.7,
    ratingCount: 3400,
    latitude: -34.6201,
    longitude: -58.3718,
    address: "Humberto 1º 400, San Telmo",
    photoUrl: "https://images.unsplash.com/photo-1543783207-ec64e4d95325?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: "place-6",
    name: "El Ateneo Grand Splendid",
    description: "Una de las librerías más bellas del mundo ubicada en un antiguo teatro preservado.",
    type: "culture",
    categoryLabel: "Cultura & Libros",
    categoryIcon: Landmark,
    rating: 4.9,
    ratingCount: 4600,
    latitude: -34.5960,
    longitude: -58.3924,
    address: "Av. Santa Fe 1860, Recoleta",
    photoUrl: "https://images.unsplash.com/photo-1497935586351-b67a49e012bf?q=80&w=600&auto=format&fit=crop",
  },
];

const FILTER_TAGS = [
  { id: "all", label: "Todos", icon: Compass },
  { id: "cafes", label: "Cafés", icon: Coffee },
  { id: "culture", label: "Cultura", icon: Landmark },
  { id: "art", label: "Arte", icon: Palette },
  { id: "history", label: "Historia", icon: Landmark },
  { id: "nature", label: "Parques", icon: Trees },
];

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { center, handleCenterChange } = useMap();
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [places, setPlaces] = useState<MapPlace[]>(CURATED_PLACES);
  const [selectedPlace, setSelectedPlace] = useState<MapPlace | null>(null);
  const [focusCoordinate, setFocusCoordinate] = useState<{ latitude: number; longitude: number } | undefined>(
    center ? { latitude: center.lat, longitude: center.lng } : { latitude: -34.6037, longitude: -58.3816 }
  );

  useEffect(() => {
    if (center && (center.lat !== 0 || center.lng !== 0)) {
      setFocusCoordinate({ latitude: center.lat, longitude: center.lng });
    }
  }, [center?.lat, center?.lng]);

  useEffect(() => {
    const loadBackendPlaces = async () => {
      try {
        const lat = center?.lat || -34.6037;
        const lng = center?.lng || -58.3816;
        const res = await fetchNearbyExperiences({
          latitude: lat,
          longitude: lng,
          radius: 10000,
        });

        if (res && res.length > 0) {
          const mapped: MapPlace[] = res.map((experience, i) => {
            const photo = CURATED_PLACES[i % CURATED_PLACES.length].photoUrl;

            return {
              id: experience.id,
              name: experience.canonicalName,
              description: experience.description || "Experiencia verificada para descubrir en tu recorrido.",
              type: "experience",
              categoryLabel: "Experiencia",
              categoryIcon: Landmark,
              rating: experience.qualityScore,
              ratingCount: undefined,
              latitude: experience.latitude ?? lat,
              longitude: experience.longitude ?? lng,
              address: "",
              photoUrl: photo,
            };
          });

          // Merge backend places with curated ones
          setPlaces([...mapped, ...CURATED_PLACES]);
        }
      } catch (err) {
        // Use curated fallback places
        setPlaces(CURATED_PLACES);
      }
    };

    loadBackendPlaces();
  }, [center]);

  const filteredPlaces = useMemo(() => {
    return places.filter((p) => {
      const matchCat =
        selectedCategory === "all" ||
        p.type.toLowerCase().includes(selectedCategory.toLowerCase()) ||
        p.categoryLabel.toLowerCase().includes(selectedCategory.toLowerCase());

      const matchSearch =
        !searchQuery.trim() ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.address.toLowerCase().includes(searchQuery.toLowerCase());

      return matchCat && matchSearch;
    });
  }, [places, selectedCategory, searchQuery]);

  const markers: Marker[] = useMemo(() => {
    return filteredPlaces.map((p) => ({
      id: p.id,
      title: p.name,
      description: p.categoryLabel,
      category: p.type,
      selected: selectedPlace?.id === p.id,
      coordinate: {
        latitude: p.latitude,
        longitude: p.longitude,
      },
      onPress: () => handleSelectPlace(p),
    }));
  }, [filteredPlaces, selectedPlace]);

  const handleSelectPlace = (place: MapPlace) => {
    setSelectedPlace(place);
    setFocusCoordinate({
      latitude: place.latitude,
      longitude: place.longitude,
    });
  };

  const handleRecenter = async () => {
    const coords = await requestAndGetCurrentLocation({ showPromptOnDenial: true });
    if (coords) {
      handleCenterChange(coords);
      setFocusCoordinate({
        latitude: coords.lat,
        longitude: coords.lng,
      });
      return;
    }

    const target = center
      ? { latitude: center.lat, longitude: center.lng }
      : { latitude: -34.6037, longitude: -58.3816 };
    setFocusCoordinate(target);
  };

  const handleGenerateTourFromPlace = (place: MapPlace) => {
    router.push({
      pathname: "/tours/wizard",
      params: {
        destination: `${place.name}, ${place.address}`,
        category: place.type || "walking",
      },
    });
  };

  return (
    <Box flex={1} bg="$backgroundLight50" position="relative">
      {/* Full screen Map */}
      <Box flex={1}>
        <Map
          markers={markers}
          focusCoordinate={focusCoordinate}
          zoomable={true}
        />
      </Box>

      {/* Floating Top Controls (Search & Category Chips) */}
      <Box
        position="absolute"
        left={16}
        right={16}
        zIndex={20}
        style={{ top: insets.top + 12 }}
      >
        <VStack space="sm">
          {/* Search Box */}
          <HStack
            bg="$white"
            borderRadius="$2xl"
            borderWidth={1}
            borderColor="$borderLight200"
            alignItems="center"
            px="$3.5"
            py="$2"
            shadowColor="$black"
            shadowOffset={{ width: 0, height: 4 }}
            shadowOpacity={0.08}
            shadowRadius={10}
            elevation={4}
          >
            <Icon as={Search} size="sm" color="$textLight400" mr="$2" />
            <Input borderWidth={0} flex={1} h={28} p="$0">
              <InputField
                placeholder="Buscar puntos de interés en el mapa..."
                value={searchQuery}
                onChangeText={setSearchQuery}
                color="$textLight900"
                fontSize="$sm"
              />
            </Input>
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery("")}>
                <Icon as={X} size="xs" color="$textLight400" />
              </Pressable>
            ) : (
              <Box p="$1" bg="$primary50" borderRadius="$full">
                <Icon as={Compass} size="xs" color="$primary600" />
              </Box>
            )}
          </HStack>

          {/* Category Chips Horizontal Scroll */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {FILTER_TAGS.map((tag) => {
              const isSelected = selectedCategory === tag.id;
              const IconComp = tag.icon;
              return (
                <Pressable
                  key={tag.id}
                  onPress={() => setSelectedCategory(tag.id)}
                >
                  <HStack
                    bg={isSelected ? "$primary500" : "rgba(255, 255, 255, 0.95)"}
                    px="$3"
                    py="$1.5"
                    borderRadius="$full"
                    alignItems="center"
                    space="xs"
                    borderWidth={1}
                    borderColor={isSelected ? "$primary500" : "$borderLight200"}
                    shadowColor="$black"
                    shadowOffset={{ width: 0, height: 2 }}
                    shadowOpacity={0.06}
                    shadowRadius={4}
                    elevation={2}
                  >
                    <Icon
                      as={IconComp}
                      size="2xs"
                      color={isSelected ? "$white" : "$textLight700"}
                    />
                    <Text
                      size="2xs"
                      fontWeight={isSelected ? "$bold" : "$medium"}
                      color={isSelected ? "$white" : "$textLight800"}
                    >
                      {tag.label}
                    </Text>
                  </HStack>
                </Pressable>
              );
            })}
          </ScrollView>
        </VStack>
      </Box>

      {/* Floating Recenter Action Button */}
      <Box position="absolute" right={16} top={160} zIndex={20}>
        <Pressable onPress={handleRecenter}>
          <Box
            w={44}
            h={44}
            borderRadius="$full"
            bg="$white"
            alignItems="center"
            justifyContent="center"
            borderWidth={1}
            borderColor="$borderLight200"
            shadowColor="$black"
            shadowOffset={{ width: 0, height: 3 }}
            shadowOpacity={0.12}
            shadowRadius={6}
            elevation={4}
          >
            <Icon as={Crosshair} size="sm" color="$primary600" />
          </Box>
        </Pressable>
      </Box>

      {/* Bottom Floating Sheet / POI Preview */}
      <Box
        position="absolute"
        bottom={85}
        left={16}
        right={16}
        zIndex={20}
      >
        {selectedPlace ? (
          /* Selected Place Card */
          <Box
            bg="$white"
            borderRadius="$3xl"
            p="$4"
            borderWidth={1}
            borderColor="$borderLight200"
            shadowColor="$black"
            shadowOffset={{ width: 0, height: 6 }}
            shadowOpacity={0.12}
            shadowRadius={16}
            elevation={6}
          >
            <HStack space="md" alignItems="center">
              <Box w={84} h={84} borderRadius="$2xl" overflow="hidden" bg="$backgroundLight200">
                <Image
                  source={{ uri: selectedPlace.photoUrl }}
                  alt={selectedPlace.name}
                  w="$full"
                  h="$full"
                  resizeMode="cover"
                />
              </Box>

              <VStack flex={1} space="xs">
                <HStack justifyContent="space-between" alignItems="center">
                  <Box bg="$primary50" px="$2" py="$0.5" borderRadius="$full">
                    <Text size="2xs" fontWeight="$bold" color="$primary700">
                      {selectedPlace.categoryLabel}
                    </Text>
                  </Box>
                  <Pressable onPress={() => setSelectedPlace(null)}>
                    <Icon as={X} size="xs" color="$textLight400" />
                  </Pressable>
                </HStack>

                <Heading size="sm" color="$textLight900" numberOfLines={1} style={{ fontFamily: FONT_DISPLAY }}>
                  {selectedPlace.name}
                </Heading>

                {selectedPlace.rating != null && (
                  <HStack space="xs" alignItems="center">
                    <Icon as={Star} size="2xs" color="$amber500" fill="#F59E0B" />
                    <Text size="2xs" fontWeight="$bold" color="$textLight800">
                      {selectedPlace.rating.toFixed(1)}
                    </Text>
                    {selectedPlace.ratingCount != null && (
                      <Text size="2xs" color="$textLight400">
                        ({selectedPlace.ratingCount} opiniones)
                      </Text>
                    )}
                  </HStack>
                )}

                <Text size="2xs" color="$textLight500" numberOfLines={1}>
                  📍 {selectedPlace.address}
                </Text>
              </VStack>
            </HStack>

            <HStack space="sm" mt="$3">
              <Button
                flex={1}
                onPress={() => setSelectedPlace(null)}
                bg="$backgroundLight100"
                borderWidth={1}
                borderColor="$borderLight200"
                borderRadius="$2xl"
                h={42}
              >
                <HStack space="xs" alignItems="center">
                  <Icon as={Eye} size="xs" color="$textLight800" />
                  <ButtonText size="xs" fontWeight="$bold" color="$textLight800">
                    Cerrar
                  </ButtonText>
                </HStack>
              </Button>

              <Button
                flex={2}
                onPress={() => handleGenerateTourFromPlace(selectedPlace)}
                bg="$primary500"
                borderRadius="$2xl"
                h={42}
                shadowColor="$primary500"
                shadowOffset={{ width: 0, height: 2 }}
                shadowOpacity={0.25}
                shadowRadius={4}
                elevation={2}
              >
                <HStack space="xs" alignItems="center">
                  <Icon as={Sparkles} size="xs" color="$secondary950" />
                  <ButtonText size="xs" fontWeight="$bold" color="$secondary950">
                    Crear Tour con IA ✨
                  </ButtonText>
                </HStack>
              </Button>
            </HStack>
          </Box>
        ) : (
          /* Place Carousel Preview */
          <VStack space="xs">
            <HStack px="$1" justifyContent="space-between" alignItems="center">
              <Text size="2xs" fontWeight="$bold" color="$textLight800" textTransform="uppercase" letterSpacing={0.8}>
                Puntos destacados ({filteredPlaces.length})
              </Text>
            </HStack>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10 }}
            >
              {filteredPlaces.map((place) => (
                <Pressable
                  key={place.id}
                  onPress={() => handleSelectPlace(place)}
                >
                  <HStack
                    bg="$white"
                    w={240}
                    h={76}
                    borderRadius="$2xl"
                    p="$2"
                    space="sm"
                    alignItems="center"
                    borderWidth={1}
                    borderColor="$borderLight200"
                    shadowColor="$black"
                    shadowOffset={{ width: 0, height: 3 }}
                    shadowOpacity={0.08}
                    shadowRadius={6}
                    elevation={3}
                  >
                    <Box w={60} h={60} borderRadius="$xl" overflow="hidden" bg="$backgroundLight200">
                      <Image
                        source={{ uri: place.photoUrl }}
                        alt={place.name}
                        w="$full"
                        h="$full"
                        resizeMode="cover"
                      />
                    </Box>
                    <VStack flex={1} space="xs">
                      <Heading size="xs" color="$textLight900" numberOfLines={1} style={{ fontFamily: FONT_DISPLAY }}>
                        {place.name}
                      </Heading>
                      <HStack space="xs" alignItems="center">
                        {place.rating != null && (
                          <>
                            <Icon as={Star} size="2xs" color="$amber500" fill="#F59E0B" />
                            <Text size="2xs" fontWeight="$bold" color="$textLight700">
                              {place.rating.toFixed(1)}
                            </Text>
                            <Text size="2xs" color="$textLight400">•</Text>
                          </>
                        )}
                        <Text size="2xs" color="$primary600" fontWeight="$medium" numberOfLines={1}>
                          {place.categoryLabel}
                        </Text>
                      </HStack>
                    </VStack>
                  </HStack>
                </Pressable>
              ))}
            </ScrollView>
          </VStack>
        )}
      </Box>
    </Box>
  );
}
