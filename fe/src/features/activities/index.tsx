import {
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  View,
} from 'react-native';
import { Activity } from './types';
import {
  BottomSheetPortal,
  BottomSheetDragIndicator,
  BottomSheetContent,
  BottomSheetSectionList,
} from '../../components/ui/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box, Text } from '@gluestack-ui/themed';
import { useState } from 'react';
import { useActivities } from '../../context/app';
import { useMap } from '../../context/app';
import { useSearchRadius } from '../../context/app';
import { fetchSimilarActivities } from '../../api/activities';
export const Activities = () => {
  const { activities, activitiesLoading, getActivities } = useActivities();
  const { center } = useMap();
  const insets = useSafeAreaInsets();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [similarLoadingId, setSimilarLoadingId] = useState<string | null>(null);
  const [similarById, setSimilarById] = useState<Record<string, any[]>>({});
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const defaultRadius = Number(
    process.env.EXPO_PUBLIC_DEFAULT_RADIUS_METERS ?? 3000
  );
  const { radiusMeters, setRadiusMeters } = useSearchRadius();

  const toggleType = (t: string) => {
    setTypeFilter((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const handleLoadSimilar = async (id: string) => {
    try {
      setSimilarLoadingId(id);
      const data = await fetchSimilarActivities(id, 6);
      setSimilarById((prev) => ({ ...prev, [id]: data }));
    } catch (e) {
      setSimilarById((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setSimilarLoadingId(null);
    }
  };

  const visibleActivities = typeFilter.length
    ? activities.filter(
        (a: any) =>
          a.knownActivityTypeName &&
          typeFilter.includes(String(a.knownActivityTypeName).toLowerCase())
      )
    : activities;

  const sections = Object.entries(
    visibleActivities.reduce(
      (acc, activity) => {
        const type = activity.knownActivityTypeName || 'Other';
        if (!acc[type]) acc[type] = [];
        acc[type].push(activity);
        return acc;
      },
      {} as Record<string, Activity[]>
    )
  ).map(([type, data]) => ({ title: type, data }));

  return (
    <BottomSheetPortal
      snapPoints={['25%', '50%', '100%']}
      handleComponent={BottomSheetDragIndicator}
      enablePanDownToClose={false}
      index={1}
    >
      <BottomSheetContent style={{ flex: 1 }}>
        <Box
          style={{
            paddingVertical: 10,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Activities</Text>
          <TouchableOpacity
            onPress={() => setFiltersOpen(true)}
            style={{
              backgroundColor: '#ddd',
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 6,
              marginRight: 8,
            }}
          >
            <Text style={{ color: '#000', fontWeight: 'bold' }}>Filtros</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              getActivities({
                forceRefresh: true,
                lat: center.lat,
                lng: center.lng,
                // @ts-ignore pass-through; backend will accept types array
                types: typeFilter,
                radius: radiusMeters,
              })
            }
            style={{
              backgroundColor: '#000',
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 6,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>
              Buscar actividades
            </Text>
          </TouchableOpacity>
        </Box>

        {/* Modal de filtros */}
        <Modal visible={filtersOpen} transparent animationType='fade'>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text
                style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}
              >
                Filtrar por tipo
              </Text>
              {[
                'cultural',
                'food',
                'outdoor',
                'nightlife',
                'entertainment',
              ].map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => toggleType(t)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 8,
                  }}
                >
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 3,
                      borderWidth: 1,
                      borderColor: '#333',
                      marginRight: 8,
                      backgroundColor: typeFilter.includes(t)
                        ? '#000'
                        : 'transparent',
                    }}
                  />
                  <Text style={{ textTransform: 'capitalize' }}>{t}</Text>
                </TouchableOpacity>
              ))}

              {/* Radius selector */}
              <View style={{ marginTop: 12 }}>
                <Text style={{ marginBottom: 6, fontWeight: '600' }}>
                  Radio de búsqueda
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {[
                    { label: '500 m', value: 500 },
                    { label: '1 km', value: 1000 },
                    { label: '3 km', value: 3000 },
                    { label: '5 km', value: 5000 },
                    { label: '10 km', value: 10000 },
                  ].map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => setRadiusMeters(opt.value)}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: '#333',
                        marginRight: 8,
                        marginBottom: 8,
                        backgroundColor:
                          radiusMeters === opt.value ? '#000' : 'transparent',
                      }}
                    >
                      <Text
                        style={{
                          color: radiusMeters === opt.value ? '#fff' : '#000',
                        }}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ color: '#666', marginTop: 4 }}>
                  Dentro de{' '}
                  {radiusMeters >= 1000
                    ? `${(radiusMeters / 1000).toFixed(1)} km`
                    : `${radiusMeters} m`}
                </Text>
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'flex-end',
                  marginTop: 16,
                }}
              >
                <TouchableOpacity
                  onPress={() => setFiltersOpen(false)}
                  style={{ paddingHorizontal: 12, paddingVertical: 8 }}
                >
                  <Text>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setFiltersOpen(false)}
                  style={{
                    backgroundColor: '#000',
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 6,
                    marginLeft: 8,
                  }}
                >
                  <Text style={{ color: '#fff' }}>Aplicar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setTypeFilter([])}
                  style={{
                    backgroundColor: '#eee',
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 6,
                    marginLeft: 8,
                  }}
                >
                  <Text>Limpiar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {activitiesLoading ? (
          <Box style={{ alignItems: 'center', paddingVertical: 16 }}>
            <ActivityIndicator size='small' />
            <Text style={{ marginTop: 8, color: '#666' }}>
              Buscando actividades…
            </Text>
          </Box>
        ) : sections.length === 0 ? (
          <Box style={{ alignItems: 'center', paddingVertical: 16 }}>
            <Text style={{ color: '#666' }}>
              No hay actividades aún. Busca una dirección o toca “Buscar
              actividades”.
            </Text>
          </Box>
        ) : (
          <BottomSheetSectionList
            style={{ flex: 1 }}
            sections={sections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: insets.bottom }}
            renderSectionHeader={({ section: { title } }) => (
              <Box
                style={{
                  backgroundColor: 'black',
                  padding: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: 'bold',
                    color: 'white',
                  }}
                >
                  {title}
                </Text>
              </Box>
            )}
            renderItem={({ item }) => (
              <Box
                style={[styles.container]}
                onTouchEnd={() => {
                  setExpandedId(expandedId === item.id ? null : item.id);
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: 'bold' }}>
                  {item.name}
                </Text>
                <Text
                  numberOfLines={expandedId === item.id ? undefined : 2}
                  ellipsizeMode='tail'
                >
                  {item.description}
                </Text>
                <Text style={{ fontSize: 12, color: 'gray' }}>
                  {item.formattedAddress}
                </Text>
                <Text style={{ fontSize: 14 }}>
                  {`(${item.knownActivityTypeName})`}
                </Text>
                <Text style={{ fontSize: 12, color: '#333', marginTop: 4 }}>
                  {`⭐ ${item.rating?.toFixed?.(1) ?? '–'} (${item.ratingCount ?? 0}) · Ponderado ${
                    item.weightedScore !== undefined
                      ? (
                          Math.round(
                            (item.weightedScore + Number.EPSILON) * 10
                          ) / 10
                        ).toFixed(1)
                      : '–'
                  } · ${item.distance !== undefined ? item.distance.toFixed(1) : '–'} km`}
                </Text>

                {expandedId === item.id && (
                  <Box style={{ marginTop: 8 }}>
                    <TouchableOpacity
                      onPress={() => handleLoadSimilar(item.id)}
                      style={{
                        backgroundColor: '#f0f0f0',
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 6,
                        alignSelf: 'flex-start',
                      }}
                    >
                      <Text>Ver similares</Text>
                    </TouchableOpacity>

                    {similarLoadingId === item.id && (
                      <Box style={{ paddingVertical: 8 }}>
                        <Text style={{ color: '#666' }}>
                          Buscando similares…
                        </Text>
                      </Box>
                    )}

                    {similarById[item.id]?.length > 0 && (
                      <Box style={{ marginTop: 8 }}>
                        <Text style={{ fontWeight: 'bold', marginBottom: 4 }}>
                          Similares
                        </Text>
                        {similarById[item.id].map((s) => (
                          <Box key={s.id} style={{ paddingVertical: 4 }}>
                            <Text style={{ fontWeight: '600' }}>{s.name}</Text>
                            <Text numberOfLines={1} ellipsizeMode='tail'>
                              {s.formattedAddress}
                            </Text>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            )}
            stickySectionHeadersEnabled={true}
            showsVerticalScrollIndicator={true}
          />
        )}
      </BottomSheetContent>
    </BottomSheetPortal>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    padding: 10,
    borderWidth: 1,
    borderColor: 'gray',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
});
