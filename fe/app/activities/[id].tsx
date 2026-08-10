import React, { useEffect, useState } from 'react';
import { ScrollView, ActivityIndicator, Linking } from 'react-native';
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Image,
  Badge,
  BadgeText,
  Button,
  Icon,
  Pressable,
} from '@gluestack-ui/themed';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, MapPin, Phone, Globe, Star } from 'lucide-react-native';
import { fetchActivityById, ActivityDetail } from '../../api/activities';
import { getImage } from '../../components/tour-details/utils';

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const loadActivity = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const data = await fetchActivityById(id);
        setActivity(data);
      } catch (error) {
        console.error('Failed to fetch activity:', error);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    loadActivity();
  }, [id]);

  if (loading) {
    return (
      <Box
        flex={1}
        bg='$backgroundLight50'
        justifyContent='center'
        alignItems='center'
      >
        <ActivityIndicator size='large' color='#0000ff' />
      </Box>
    );
  }

  if (notFound || !activity) {
    return (
      <Box
        flex={1}
        bg='$backgroundLight50'
        justifyContent='center'
        alignItems='center'
        p='$4'
      >
        <Text textAlign='center'>No pudimos encontrar esta actividad.</Text>
        <Button mt='$4' onPress={() => router.back()}>
          <Text color='$white'>Volver</Text>
        </Button>
      </Box>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Box flex={1} bg='$backgroundLight50'>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* Hero image with back button */}
          <Box height={280} width='$full' position='relative'>
            <Image
              source={{ uri: getImage(activity.photos) }}
              alt={activity.name}
              w='$full'
              h='$full'
              resizeMode='cover'
            />
            <Box position='absolute' top={50} left={20} zIndex={10}>
              <Button
                size='sm'
                variant='solid'
                action='secondary'
                bg='rgba(255,255,255,0.2)'
                onPress={() => router.back()}
                borderRadius='$full'
                p='$2'
              >
                <Icon as={ArrowLeft} color='$white' size='xl' />
              </Button>
            </Box>
          </Box>

          <VStack p='$4' space='sm'>
            <Heading size='xl'>{activity.name}</Heading>

            <HStack space='sm' alignItems='center' flexWrap='wrap'>
              {activity.type && (
                <Badge action='success' variant='outline' borderRadius='$sm'>
                  <BadgeText>{activity.type}</BadgeText>
                </Badge>
              )}
              {activity.price ? (
                <Badge action='info' variant='outline' borderRadius='$sm'>
                  <BadgeText>${activity.price}</BadgeText>
                </Badge>
              ) : null}
              {activity.rating ? (
                <HStack alignItems='center' space='xs'>
                  <Icon as={Star} size='xs' color='$warning500' />
                  <Text size='sm' fontWeight='$bold'>
                    {activity.rating.toFixed(1)}
                  </Text>
                  {activity.ratingCount ? (
                    <Text size='xs' color='$textLight500'>
                      ({activity.ratingCount})
                    </Text>
                  ) : null}
                </HStack>
              ) : null}
            </HStack>

            {activity.description ? (
              <Text color='$textLight600' mt='$2'>
                {activity.description}
              </Text>
            ) : null}

            {(activity.formattedAddress || activity.address) && (
              <HStack space='xs' alignItems='center' mt='$3'>
                <Icon as={MapPin} size='sm' color='$textLight500' />
                <Text size='sm' color='$textLight600' flex={1}>
                  {activity.formattedAddress || activity.address}
                </Text>
              </HStack>
            )}

            {activity.phoneNumber && (
              <Pressable onPress={() => Linking.openURL(`tel:${activity.phoneNumber}`)}>
                <HStack space='xs' alignItems='center' mt='$2'>
                  <Icon as={Phone} size='sm' color='$textLight500' />
                  <Text size='sm' color='$primary600'>
                    {activity.phoneNumber}
                  </Text>
                </HStack>
              </Pressable>
            )}

            {activity.website && (
              <Pressable onPress={() => Linking.openURL(activity.website as string)}>
                <HStack space='xs' alignItems='center' mt='$2'>
                  <Icon as={Globe} size='sm' color='$textLight500' />
                  <Text size='sm' color='$primary600' numberOfLines={1}>
                    {activity.website}
                  </Text>
                </HStack>
              </Pressable>
            )}
          </VStack>
        </ScrollView>
      </Box>
    </>
  );
}
