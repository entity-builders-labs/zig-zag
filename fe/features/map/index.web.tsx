import React, { useRef } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';
import { useMap } from '../../context/app';
import { useActivities } from '../../context/app';
import { MapProps } from './types';
import { Activity } from '../activities/types';
import { Marker as MarkerType } from './types';

// Function to create markers from activities
const createMarkersFromActivities = (activities: Activity[]): MarkerType[] => {
  return activities.map((activity) => ({
    id: activity.id,
    coordinate: {
      latitude: activity.latitude,
      longitude: activity.longitude,
    },
    title: activity.name,
    description: activity.description,
    order: activity.order,
  }));
};

export const Map: React.FC<MapProps> = ({
  markers: propMarkers,
  isStatic = false,
  initialRegion,
}) => {
  const { center, handleCenterChange } = useMap();
  const { activities } = useActivities();
  const mapRef = useRef<google.maps.Map | null>(null);

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  // Debug: log if API key is missing (only in development)
  if (__DEV__ && !apiKey) {
    console.warn('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set!');
  }

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: apiKey,
  });

  if (loadError) {
    console.error('Google Maps load error:', loadError);
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>
            Error loading Google Maps: {loadError.message}
          </Text>
        </View>
      </View>
    );
  }

  // Create markers from activities if no markers are provided via props
  const markers = propMarkers || createMarkersFromActivities(activities);

  const mapCenter = initialRegion
    ? { lat: initialRegion.latitude, lng: initialRegion.longitude }
    : { lat: center.lat, lng: center.lng };

  if (!isLoaded) {
    return <View style={styles.container} />;
  }

  const handleMapDragEnd = () => {
    if (isStatic) return;
    if (mapRef.current) {
      const newCenter = mapRef.current.getCenter();
      if (newCenter) {
        handleCenterChange({
          lat: newCenter.lat(),
          lng: newCenter.lng(),
        });
      }
    }
  };

  const mapOptions: google.maps.MapOptions = isStatic
    ? {
        disableDefaultUI: true,
        draggable: false,
        zoomControl: false,
        scrollwheel: false,
        disableDoubleClickZoom: true,
        clickableIcons: false,
      }
    : {
        disableDefaultUI: false,
        zoomControl: true,
      };

  return (
    <View style={styles.container}>
      <GoogleMap
        mapContainerStyle={styles.map}
        center={mapCenter}
        zoom={15}
        onLoad={(map) => {
          mapRef.current = map;
        }}
        onDragEnd={handleMapDragEnd}
        options={mapOptions}
      >
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={{
              lat: marker.coordinate.latitude,
              lng: marker.coordinate.longitude,
            }}
            title={marker.title}
            label={marker.order ? marker.order.toString() : undefined}
          />
        ))}
      </GoogleMap>
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  errorText: {
    color: '#d32f2f',
    fontSize: 16,
    textAlign: 'center',
  },
});
