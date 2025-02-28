import React, { useEffect, useState } from 'react';

// Array of visually distinct colors for routes
const routeColors = [
  '#FF6B6B', // Coral Red
  '#4ECDC4', // Turquoise
  '#45B7D1', // Sky Blue
  '#96CEB4', // Sage Green
  '#FFEEAD', // Cream Yellow
  '#D4A5A5', // Dusty Rose
  '#9B59B6', // Purple
  '#3498DB', // Blue
  '#E67E22', // Orange
  '#2ECC71', // Emerald Green
];
import {
  StyleSheet,
  Dimensions,
  Platform,
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { MapProps } from './types';
const defaultRegion: Region = {
  latitude: 37.78825,
  longitude: -122.4324,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};

const defaultTestRoute = {
  coordinates: [
    { latitude: 37.78825, longitude: -122.4324 },
    { latitude: 37.79825, longitude: -122.4424 },
    { latitude: 37.80825, longitude: -122.4524 },
  ],
};

export const Map: React.FC<MapProps> = ({
  initialRegion = defaultRegion,
  markers = [],
  onRegionChange,
  focusCoordinate,
  onRefresh,
  routes = [],
}) => {
  const [region, setRegion] = useState<Region>(initialRegion);

  const handleRefresh = async () => {
    if (focusCoordinate) {
      setRegion((prev) => ({
        ...prev,
        latitude: focusCoordinate.latitude,
        longitude: focusCoordinate.longitude,
      }));
    } else if (markers.length > 0) {
      setRegion((prev) => ({
        ...prev,
        latitude: markers[0].coordinate.latitude,
        longitude: markers[0].coordinate.longitude,
      }));
    } else {
      const location = await Location.getCurrentPositionAsync({});
      setRegion((prev) => ({
        ...prev,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      }));
    }
  };

  // Use default test route if no routes provided
  const displayRoutes = routes.length > 0 ? routes : [defaultTestRoute];

  // Update region when markers or focus coordinate changes
  useEffect(() => {
    if (focusCoordinate) {
      setRegion((prev) => ({
        ...prev,
        latitude: focusCoordinate.latitude,
        longitude: focusCoordinate.longitude,
      }));
    } else if (markers.length > 0) {
      setRegion((prev) => ({
        ...prev,
        latitude: markers[0].coordinate.latitude,
        longitude: markers[0].coordinate.longitude,
      }));
    } else {
      // Get current location if no markers or focus point
      const getLocation = async () => {
        const location = await Location.getCurrentPositionAsync({});
        setRegion((prev) => ({
          ...prev,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        }));
      };
      getLocation();
    }
  }, [markers, focusCoordinate]);
  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        region={region}
        showsUserLocation={true}
        onRegionChange={(
          e: Region | { latLng: { lat: () => number; lng: () => number } }
        ) => {
          if (onRegionChange) {
            if (Platform.OS === 'web' && 'latLng' in e) {
              onRegionChange({
                latitude: e.latLng.lat(),
                longitude: e.latLng.lng(),
                latitudeDelta: 0.0922,
                longitudeDelta: 0.0421,
              });
            } else if ('latitude' in e) {
              onRegionChange(e as Region);
            }
          }
        }}
        toolbarEnabled
        zoomControlEnabled
      >
        {displayRoutes.map((route) =>
          route.coordinates.map((coord, index) => {
            if (index < route.coordinates.length - 1) {
              return (
                <Polyline
                  key={`segment-${index}`}
                  coordinates={[coord, route.coordinates[index + 1]]}
                  strokeColor={routeColors[index % routeColors.length]}
                  strokeWidth={4}
                />
              );
            }
            return null;
          })
        )}
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={marker.coordinate}
            title={marker.title}
            description={marker.description}
          >
            {marker.order !== undefined && (
              <View style={styles.markerContainer}>
                <View style={styles.orderCircle}>
                  <Text style={styles.orderText}>{marker.order}</Text>
                </View>
              </View>
            )}
          </Marker>
        ))}
      </MapView>
      <TouchableOpacity style={styles.refreshButton} onPress={handleRefresh}>
        <Text style={styles.refreshButtonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderCircle: {
    position: 'absolute',
    backgroundColor: 'white',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
    top: -32,
    left: -12,
  },
  orderText: {
    color: '#000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  map: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  refreshButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  refreshButtonText: {
    color: '#000',
    fontWeight: 'bold',
  },
});
