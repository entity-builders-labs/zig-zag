import React from 'react';
import { StyleSheet, View } from 'react-native';
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

export const Map: React.FC<MapProps> = ({ markers: propMarkers }) => {
  const { center } = useMap();
  const { activities } = useActivities();

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
  });

  // Create markers from activities if no markers are provided via props
  const markers = propMarkers || createMarkersFromActivities(activities);

  if (!isLoaded) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <GoogleMap
        mapContainerStyle={styles.map}
        center={{ lat: center.lat, lng: center.lng }}
        zoom={15}
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
});
