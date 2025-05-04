import { View, Text } from '@gluestack-ui/themed';
import { FlatList } from 'react-native';
import { useTours } from './use-tours';
import { useAddress } from '../../context/app';
import { Tour } from '../../components/types';

export const Tours = () => {
  const { address } = useAddress();
  const { tours, toursError, toursLoading } = useTours(address ?? undefined);

  return (
    <View>
      {toursLoading ? (
        <Text>Loading...</Text>
      ) : (
        <FlatList<Tour | undefined>
          data={tours ?? []}
          renderItem={({ item }) => (
            <View>
              <Text key={item?.id}>{item?.id}</Text>
            </View>
          )}
          ListEmptyComponent={<Text>No tours found</Text>}
        />
      )}
    </View>
  );
};
