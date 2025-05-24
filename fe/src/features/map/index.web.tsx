import React from 'react';
import { StyleSheet, View } from 'react-native';
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api';
import { useMap } from '../../context/app';
import { MapProps } from './types';

export const Map: React.FC<MapProps> = () => {
  const { center } = useMap();
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
  });
  console.log('$$$ isLoaded:', isLoaded);
  if (!isLoaded) {
    return <View style={styles.container} />;
  }

  console.log('$$$ center:', center);

  return (
    <View style={styles.container}>
      <GoogleMap
        mapContainerStyle={styles.map}
        center={{ lat: center.lat, lng: center.lng }}
        zoom={15}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    width: '100%',
    height: '100%',
  },
  map: {
    width: '100%',
    height: '100%',
  },
});
