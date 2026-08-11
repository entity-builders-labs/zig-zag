import React, { useEffect, useRef, useState } from 'react';
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
  routes,
  zoomable,
}) => {
  const { center, handleCenterChange } = useMap();
  const { activities } = useActivities();
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  // A ref doesn't trigger a re-render/effect-run when it's populated, so
  // effects that need the live map instance (fitBounds, drawing polylines)
  // watch this state instead — it's set from onLoad, once the map actually
  // exists, not just once the JS API script has loaded.
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  // Debug: log if API key is missing (only in development)
  if (__DEV__ && !apiKey) {
    console.warn('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set!');
  }

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: apiKey,
  });

  const markers = propMarkers || createMarkersFromActivities(activities);

  // Frame every marker and route point instead of a fixed zoom level, which
  // ignored initialRegion's delta entirely and often left the map zoomed way
  // out (or in) relative to how spread out the actual points are.
  useEffect(() => {
    if (!mapInstance) return;

    const points: { lat: number; lng: number }[] = [
      ...markers.map((m) => ({
        lat: m.coordinate.latitude,
        lng: m.coordinate.longitude,
      })),
      ...(routes?.flatMap((r) =>
        r.coordinates.map((c) => ({ lat: c.latitude, lng: c.longitude }))
      ) || []),
    ];

    if (points.length === 0) return;
    if (points.length === 1) {
      mapInstance.setCenter(points[0]);
      mapInstance.setZoom(15);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    mapInstance.fitBounds(bounds, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, JSON.stringify(markers), JSON.stringify(routes)]);

  // Polylines are managed imperatively against the map instance rather than
  // via @react-google-maps/api's <Polyline> component — that component is a
  // class relying on legacy React context, which doesn't reliably render
  // under this app's React 19 / react-dom 19.1.0 (Marker uses a newer
  // pattern and is unaffected).
  useEffect(() => {
    if (!mapInstance) return;

    polylinesRef.current.forEach((polyline) => polyline.setMap(null));
    polylinesRef.current = (routes || []).map(
      (route) =>
        new google.maps.Polyline({
          path: route.coordinates.map((c) => ({
            lat: c.latitude,
            lng: c.longitude,
          })),
          strokeColor: '#3B82F6',
          strokeOpacity: 0.8,
          strokeWeight: 3,
          map: mapInstance,
        })
    );

    // Google's modern vector maps render polylines via WebGL/canvas, not
    // SVG DOM nodes, so there's nothing to query for in the page — expose
    // the live Polyline instances for E2E tests (see fe/e2e/) to assert
    // against instead.
    if (typeof window !== 'undefined') {
      (window as any).__zigzagPolylines = polylinesRef.current;
    }

    return () => {
      polylinesRef.current.forEach((polyline) => polyline.setMap(null));
      polylinesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, JSON.stringify(routes)]);

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

  const interactive = zoomable ?? !isStatic;
  // google.maps.Map#setOptions() shallow-merges — a key omitted from a new
  // options object is left at whatever it was previously set to. Both
  // branches must set every flag explicitly, or toggling between them
  // leaves stale restrictions (e.g. draggable: false survives a switch to
  // "interactive" if that branch never mentions draggable at all).
  const mapOptions: google.maps.MapOptions = interactive
    ? {
        disableDefaultUI: false,
        draggable: true,
        zoomControl: true,
        scrollwheel: true,
        disableDoubleClickZoom: false,
        clickableIcons: true,
      }
    : {
        disableDefaultUI: true,
        draggable: false,
        zoomControl: false,
        scrollwheel: false,
        disableDoubleClickZoom: true,
        clickableIcons: false,
      };

  return (
    <View style={styles.container}>
      <GoogleMap
        mapContainerStyle={styles.map}
        center={mapCenter}
        zoom={15}
        onLoad={(map) => {
          mapRef.current = map;
          setMapInstance(map);
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
