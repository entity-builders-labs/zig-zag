import { SectionList, StyleSheet } from 'react-native';
import { useActivities } from './use-activities';
import { Activity } from './types';
import {
  BottomSheetPortal,
  BottomSheetDragIndicator,
  BottomSheetContent,
} from '../../components/ui/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box, Text } from '@gluestack-ui/themed';
import { useState } from 'react';
export const Activities = () => {
  const { activities } = useActivities();
  const insets = useSafeAreaInsets();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sections = Object.entries(
    activities.reduce(
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
      <BottomSheetContent>
        <Box style={{ paddingVertical: 10 }}>
          <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Activities</Text>
        </Box>
        <SectionList
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
              <Text style={{ fontSize: 14, fontWeight: 'bold' }}>
                {` (${item.knownActivityTypeName})`}
              </Text>
            </Box>
          )}
          stickySectionHeadersEnabled={true}
          showsVerticalScrollIndicator={true}
        />
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
});
