import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { Box, HStack, Text, VStack } from '@gluestack-ui/themed';
import { Sparkles } from 'lucide-react-native';
import { FONT_DISPLAY } from '@/constants/typography';

interface TourHeaderSkeletonProps {
  height: number;
  destinationName?: string;
  tourName?: string;
}

export const TourHeaderSkeleton: React.FC<TourHeaderSkeletonProps> = ({
  height,
  destinationName,
  tourName,
}) => {
  const pulseAnim = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.85,
          duration: 900,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.2,
          duration: 900,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    pulse.start();

    return () => pulse.stop();
  }, [pulseAnim]);

  const cleanDestination = destinationName
    ? destinationName.split(',')[0].trim()
    : 'destino';

  return (
    <View style={[styles.container, { height }]}>
      {/* Background base */}
      <View style={styles.baseBackground} />

      {/* Shimmering pulse layer - appears and fades smoothly */}
      <Animated.View
        style={[
          styles.shimmerLayer,
          {
            opacity: pulseAnim,
          },
        ]}
      />

      {/* Floating glass badge indicating iconic city photo resolution */}
      <View style={styles.centerBadgeContainer}>
        <Box
          bg='rgba(15, 23, 42, 0.85)'
          borderWidth={1}
          borderColor='rgba(56, 189, 248, 0.35)'
          borderRadius='$full'
          px='$4'
          py='$2.5'
          shadowColor='$black'
          shadowOffset={{ width: 0, height: 4 }}
          shadowOpacity={0.3}
          shadowRadius={10}
          elevation={5}
        >
          <HStack space='xs' alignItems='center'>
            <Sparkles size={14} color='#38BDF8' />
            <Text size='xs' fontWeight='$bold' color='$white'>
              Buscando foto icónica de {cleanDestination}...
            </Text>
          </HStack>
        </Box>
      </View>

      {/* Bottom Skeleton Ghost Shapes for Title & Badges */}
      <Animated.View
        style={[
          styles.contentOverlay,
          {
            opacity: pulseAnim,
          },
        ]}
      >
        <VStack space='xs'>
          {/* Ghost Category Pills */}
          <HStack space='xs' alignItems='center'>
            <Box
              bg='rgba(255, 255, 255, 0.22)'
              borderRadius='$full'
              w={90}
              h={22}
            />
            <Box
              bg='rgba(255, 255, 255, 0.14)'
              borderRadius='$full'
              w={65}
              h={22}
            />
          </HStack>

          {/* Tour Name / Title Placeholder */}
          {tourName ? (
            <Text
              color='$white'
              size='xl'
              fontWeight='$bold'
              mt='$1'
              numberOfLines={2}
              style={{ fontFamily: FONT_DISPLAY }}
            >
              {tourName}
            </Text>
          ) : (
            <VStack space='xs' mt='$1'>
              <Box
                bg='rgba(255, 255, 255, 0.22)'
                borderRadius='$md'
                w='75%'
                h={24}
              />
              <Box
                bg='rgba(255, 255, 255, 0.16)'
                borderRadius='$md'
                w='45%'
                h={20}
              />
            </VStack>
          )}

          {/* Ghost Metadata Bar (rating / duration / distance) */}
          <HStack space='xs' alignItems='center' mt='$1'>
            <Box
              bg='rgba(255, 255, 255, 0.18)'
              borderRadius='$sm'
              w={45}
              h={14}
            />
            <Text size='xs' color='rgba(255,255,255,0.4)'>
              •
            </Text>
            <Box
              bg='rgba(255, 255, 255, 0.18)'
              borderRadius='$sm'
              w={70}
              h={14}
            />
            <Text size='xs' color='rgba(255,255,255,0.4)'>
              •
            </Text>
            <Box
              bg='rgba(255, 255, 255, 0.18)'
              borderRadius='$sm'
              w={60}
              h={14}
            />
          </HStack>
        </VStack>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#090D16',
  },
  baseBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0F172A',
  },
  shimmerLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#334155',
  },
  centerBadgeContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 45,
    zIndex: 5,
  },
  contentOverlay: {
    position: 'absolute',
    bottom: 44,
    left: 16,
    right: 16,
    zIndex: 6,
  },
});
