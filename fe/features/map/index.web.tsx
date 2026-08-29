import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';
import { useMap } from '../../context/app';
import { useActivities } from '../../context/app';
import { MapProps } from './types';
import { Activity } from '../activities/types';
import { Marker as MarkerType } from './types';
import { ZIGZAG_WARM_MAP_STYLE } from '../../constants/map-style';
import { createSvgMarkerUrl } from './utils';

// Exposes one Map instance's live polylines/polygons for E2E tests to assert
// against (nothing renders to the DOM for a WebGL/canvas map, see the two
// effects below). Without an instanceId, an instance writes to the legacy
// top-level globals directly — only the tour header's map omits instanceId,
// so existing specs asserting `window.__zigzagPolylines` keep working
// unchanged. Any other instance (e.g. a CompositeStopCard's mini-map) MUST
// pass a unique instanceId, or it would silently clobber the header's data.
function exposeMapInstanceData(
  instanceId: string | undefined,
  key: 'polylines' | 'polygons',
  value: unknown
): void {
  if (typeof window === 'undefined') return;
  if (!instanceId) {
    (window as any)[key === 'polylines' ? '__zigzagPolylines' : '__zigzagPolygons'] =
      value;
    return;
  }
  const w = window as any;
  w.__zigzagMapInstances = w.__zigzagMapInstances || {};
  w.__zigzagMapInstances[instanceId] = {
    ...w.__zigzagMapInstances[instanceId],
    [key]: value,
  };
}

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
  polygons,
  zoomable,
  instanceId,
}) => {
  const { center, handleCenterChange } = useMap();
  const { activities } = useActivities();
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
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
      ...(polygons?.flatMap((p) =>
        p.coordinates.map((c) => ({ lat: c.latitude, lng: c.longitude }))
      ) || []),
    ];

    if (points.length === 0) return;

    // Google Maps computes the zoom needed to fit `points` from the
    // container's CURRENT pixel size at the moment this runs. A map mounted
    // deep inside a scrolling list (e.g. a CompositeStopCard's mini-map,
    // several siblings down in a flex column) can still be mid-layout —
    // 0 or transiently-sized — when `onLoad` fires and this effect's first
    // run happens, producing a zoom level that never gets corrected once
    // the container reaches its real size. The map instance's own div
    // (google.maps.Map#getDiv) is the thing that actually has that size,
    // not any of our own refs, so ResizeObserver watches THAT — reapplying
    // framing (via a real 'resize' event, which is what makes Maps
    // re-measure its container) every time it changes, not just once.
    const applyFraming = () => {
      if (points.length === 1) {
        mapInstance.setCenter(points[0]);
        mapInstance.setZoom(15);
        return;
      }
      const bounds = new google.maps.LatLngBounds();
      points.forEach((p) => bounds.extend(p));
      // Asymmetric padding, not a flat 40 on every side: a short mini-map
      // (e.g. CompositeStopCard's) has height as its scarce dimension —
      // a big top/bottom padding eats a much larger fraction of the
      // available height than the same padding eats of the width, forcing
      // fitBounds to zoom out far more than the points actually need.
      mapInstance.fitBounds(bounds, { top: 16, bottom: 16, left: 24, right: 24 });
    };

    applyFraming();

    const container = mapInstance.getDiv();
    let lastSize = '';
    // ResizeObserver/window aren't in this file's TS lib target (a
    // pre-existing gap, see the other `window` references above) — real
    // globals at runtime in a browser, just untyped here.
    const ResizeObserverCtor = (window as any).ResizeObserver;
    const resizeObserver = new ResizeObserverCtor((entries: any[]) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      const size = `${width}x${height}`;
      if (size === lastSize) return;
      lastSize = size;
      google.maps.event.trigger(mapInstance, 'resize');
      applyFraming();
    });
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mapInstance,
    JSON.stringify(markers),
    JSON.stringify(routes),
    JSON.stringify(polygons),
  ]);

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
    exposeMapInstanceData(instanceId, 'polylines', polylinesRef.current);

    return () => {
      polylinesRef.current.forEach((polyline) => polyline.setMap(null));
      polylinesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, JSON.stringify(routes), instanceId]);

  // Same imperative treatment as Polylines above, for the same React 19
  // legacy-context reason — @react-google-maps/api's <Polygon> component
  // doesn't reliably render either. Google's Polygon interprets the first
  // path in `paths` as the outer ring and every subsequent one as a hole.
  useEffect(() => {
    if (!mapInstance) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = (polygons || []).map(
      (polygon) =>
        new google.maps.Polygon({
          paths: [
            polygon.coordinates.map((c) => ({
              lat: c.latitude,
              lng: c.longitude,
            })),
            ...(polygon.holes || []).map((hole) =>
              hole.map((c) => ({ lat: c.latitude, lng: c.longitude }))
            ),
          ],
          strokeColor: polygon.strokeColor || '#3B82F6',
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: polygon.fillColor || '#3B82F6',
          fillOpacity: 0.15,
          map: mapInstance,
        })
    );

    // Same rationale as __zigzagPolylines above — nothing to query in the
    // DOM for a WebGL/canvas-rendered shape, so expose the live instances.
    exposeMapInstanceData(instanceId, 'polygons', polygonsRef.current);

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, JSON.stringify(polygons), instanceId]);

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
        styles: ZIGZAG_WARM_MAP_STYLE,
      }
    : {
        disableDefaultUI: true,
        draggable: false,
        zoomControl: false,
        scrollwheel: false,
        disableDoubleClickZoom: true,
        clickableIcons: false,
        styles: ZIGZAG_WARM_MAP_STYLE,
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
        {markers.map((marker) => {
          const iconUrl = createSvgMarkerUrl({
            order: marker.order,
            icon: marker.icon,
            category: marker.category,
            title: marker.title,
            color: marker.color,
            selected: marker.selected,
          });

          return (
            <Marker
              key={marker.id}
              position={{
                lat: marker.coordinate.latitude,
                lng: marker.coordinate.longitude,
              }}
              title={marker.title}
              icon={{
                url: iconUrl,
                scaledSize: new google.maps.Size(38, 46),
                anchor: new google.maps.Point(19, 44),
              }}
              onClick={marker.onPress}
            />
          );
        })}
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
