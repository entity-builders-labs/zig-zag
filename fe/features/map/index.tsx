import React from 'react';
import { StyleSheet, Dimensions, View, Text } from 'react-native';
import MapView, { Region, Marker, Circle } from 'react-native-maps';
import { useMap } from '../../context/app';
import { useAddress } from '../../context/app';
import { useSearchRadius } from '../../context/app';
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
  const { center } = useMap();
  const { address } = useAddress();
  const { activities } = useActivities();
  const { radiusMeters } = useSearchRadius();

  const contextRegion: Region = {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  };

  const region = initialRegion || contextRegion;
  console.log('$$$ region:', initialRegion, contextRegion);
  // Create markers from activities if no markers are provided via props
  const markers = propMarkers || createMarkersFromActivities(activities);

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        region={region}
        // Mostrar la ubicación real solo como referencia, pero marcamos el centro elegido
        showsUserLocation={false}
        toolbarEnabled={!isStatic}
        zoomControlEnabled={!isStatic}
        scrollEnabled={!isStatic}
        zoomEnabled={!isStatic}
        pitchEnabled={!isStatic}
        rotateEnabled={!isStatic}
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
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={marker.coordinate}
            title={marker.title}
            description={marker.description}
          >
            {marker.order && (
              <View style={styles.markerContainer}>
                <View style={styles.orderCircle}>
                  <Text style={styles.orderText}>{marker.order}</Text>
                </View>
              </View>
            )}
          </Marker>
        ))}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
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
