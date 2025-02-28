import { View, Text } from '@gluestack-ui/themed';
import { FlatList } from 'react-native';
import { useActivities } from './use-activities';
import { Activity } from './types';

export const Activities = () => {
  const { activities, activitiesLoading } = useActivities();

  return (
    <View>
      {activitiesLoading ? (
        <Text>Loading...</Text>
      ) : (
        <FlatList<Activity | undefined>
          data={activities ?? []}
          renderItem={({ item }) => (
            <View>
              <Text key={item?.id}>{item?.name}</Text>
            </View>
          )}
          ListEmptyComponent={<Text>No activities found</Text>}
        />
      )}
    </View>
  );
};
