import React from 'react';

import { StyleSheet, Dimensions, View } from 'react-native';
import MapView, { Region } from 'react-native-maps';
import { useMap } from '../../context/app';
import { MapProps } from './types';

export const Map: React.FC<MapProps> = () => {
  const { center } = useMap();

  const region: Region = {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  };

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        region={region}
        showsUserLocation={true}
        toolbarEnabled
        zoomControlEnabled
      ></MapView>
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
