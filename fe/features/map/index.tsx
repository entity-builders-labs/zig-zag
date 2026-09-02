import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
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


export const Map: React.FC<MapProps> = ({
  markers: propMarkers,
  isStatic = false,
  initialRegion,
  routes,
  polygons,
  zoomable,
}) => {
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
  // Create markers from activities if no markers are provided via props
  const markers = propMarkers || [];
  const interactive = zoomable ?? !isStatic;

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        region={region}
        customMapStyle={ZIGZAG_WARM_MAP_STYLE}
        // Mostrar la ubicación real solo como referencia, pero marcamos el centro elegido
        showsUserLocation={false}
        toolbarEnabled={interactive}
        zoomControlEnabled={interactive}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        pitchEnabled={interactive}
        rotateEnabled={interactive}
      >
        {!isStatic && (
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
    transform: [{ scale: 1.15 }],
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
