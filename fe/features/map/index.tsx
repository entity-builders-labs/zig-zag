import React, { useRef, useState, useEffect } from 'react';
import { AppState, StyleSheet, View, Text } from 'react-native';
import MapView, {
  Region,
  Marker,
  Circle,
  Polyline,
  Polygon,
} from 'react-native-maps';
import { useMap } from '../../context/app';
import { useAddress } from '../../context/app';
import { useSearchRadius } from '../../context/app';
import { MapProps } from './types';
import { Marker as MarkerType } from './types';
import { ZIGZAG_WARM_MAP_STYLE } from '../../constants/map-style';
import { getCategoryEmoji } from './utils';
import { checkLocationPermission } from '../../utils/location';

export const Map: React.FC<MapProps> = ({
  markers: propMarkers,
  isStatic = false,
  initialRegion,
  routes,
  polygons,
  zoomable,
  focusCoordinate,
  onRegionChange,
}) => {
  const mapRef = useRef<MapView | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const refreshPermission = async () => {
      const granted = await checkLocationPermission();
      if (isMounted) setHasLocationPermission(granted);
    };

    void refreshPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      // Permission dialogs/settings can change foreground permission while the
      // Map stays mounted. Re-check when the app becomes active so the blue
      // user-location indicator does not remain stale until a remount.
      if (state === 'active') void refreshPermission();
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  const { center } = useMap();
  const { address } = useAddress();
  const { radiusMeters } = useSearchRadius();

  const contextRegion: Region = {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  };

  const region = initialRegion || contextRegion;
  // Create markers from experiences if no markers are provided via props
  const markers = propMarkers || [];
  const interactive = zoomable ?? !isStatic;

  // Key based only on coordinates so selection changes don't re-trigger camera motion
  const markersGeoKey = markers
    .map(
      (m) =>
        `${m.coordinate.latitude.toFixed(5)},${m.coordinate.longitude.toFixed(5)}`
    )
    .join(';');

  useEffect(() => {
    if (!mapRef.current || !isMapReady) return;

    if (focusCoordinate) {
      mapRef.current.animateToRegion(
        {
          latitude: focusCoordinate.latitude,
          longitude: focusCoordinate.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        },
        500
      );
      return;
    }

    if (markers.length === 1) {
      const coord = markers[0].coordinate;
      mapRef.current.animateToRegion(
        {
          latitude: coord.latitude,
          longitude: coord.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        },
        500
      );
      return;
    }

    if (markers.length > 1) {
      mapRef.current.fitToCoordinates(
        markers.map((m) => m.coordinate),
        {
          edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
          animated: true,
        }
      );
      return;
    }

    if (center && (center.lat !== 0 || center.lng !== 0)) {
      mapRef.current.animateToRegion(
        {
          latitude: center.lat,
          longitude: center.lng,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        },
        500
      );
    }
  }, [
    isMapReady,
    focusCoordinate?.latitude,
    focusCoordinate?.longitude,
    markersGeoKey,
    center.lat,
    center.lng,
  ]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        onMapReady={() => setIsMapReady(true)}
        style={styles.map}
        initialRegion={region}
        region={isStatic ? region : undefined}
        onRegionChangeComplete={onRegionChange}
        customMapStyle={ZIGZAG_WARM_MAP_STYLE}
        showsUserLocation={hasLocationPermission}
        toolbarEnabled={interactive}
        zoomControlEnabled={interactive}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        pitchEnabled={interactive}
        rotateEnabled={interactive}
      >
        {!isStatic && markers.length === 0 && !initialRegion && (
          <>
            {/* Pin del centro seleccionado (dirección o current location) */}
            <Marker
              coordinate={{ latitude: center.lat, longitude: center.lng }}
              title={address?.street || 'Centro seleccionado'}
              description={
                address
                  ? `${address.lat.toFixed(4)}, ${address.lng.toFixed(4)}`
                  : ''
              }
              pinColor='#007AFF'
            />
            {/* Círculo del radio seleccionado */}
            <Circle
              center={{ latitude: center.lat, longitude: center.lng }}
              radius={radiusMeters}
              strokeColor='rgba(0,122,255,0.6)'
              fillColor='rgba(0,122,255,0.15)'
            />
          </>
        )}
        {routes?.map((route, index) => (
          <Polyline
            key={index}
            coordinates={route.coordinates}
            strokeColor='#3B82F6'
            strokeWidth={3}
          />
        ))}
        {polygons?.map((polygon, index) => (
          <Polygon
            key={index}
            coordinates={polygon.coordinates}
            holes={polygon.holes}
            strokeColor={polygon.strokeColor || '#3B82F6'}
            fillColor={polygon.fillColor || 'rgba(59,130,246,0.15)'}
            strokeWidth={2}
          />
        ))}
        {markers.map((marker) => {
          const emoji = marker.icon || (marker.order != null ? null : getCategoryEmoji(marker.category, marker.title));
          const isSelected = marker.selected;

          return (
            <Marker
              key={marker.id}
              coordinate={marker.coordinate}
              title={marker.title}
              description={marker.description}
              onPress={marker.onPress}
              anchor={{ x: 0.5, y: 1.0 }}
              tracksViewChanges={false}
              zIndex={isSelected ? 99 : 1}
            >
              <View style={styles.customPinContainer}>
                <View style={[styles.customPinBody, isSelected && styles.customPinBodySelected]}>
                  <Text style={styles.customPinText}>
                    {marker.order != null ? marker.order : (emoji || '★')}
                  </Text>
                </View>
                <View style={[styles.customPinTriangle, isSelected && styles.customPinTriangleSelected]} />
              </View>
            </Marker>
          );
        })}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    flex: 1,
  },
  customPinContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  customPinBody: {
    backgroundColor: '#EA580C',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 5,
    minWidth: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  customPinBodySelected: {
    backgroundColor: '#0F172A',
    borderColor: '#FFFFFF',
    borderWidth: 2.5,
  },
  customPinTriangle: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 0,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#EA580C',
    marginTop: -1,
  },
  customPinTriangleSelected: {
    borderTopColor: '#0F172A',
  },
  customPinText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  map: {
    flex: 1,
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
