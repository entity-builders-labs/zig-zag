import React from 'react';
import { StyleSheet, Dimensions } from 'react-native';
import { GluestackUIProvider, Box, Text, VStack } from '@gluestack-ui/themed';
import { ErrorBoundary } from 'react-error-boundary';
import { config } from '@gluestack-ui/config';
import { SearchByAddressInput } from '../features/search-by-address-input';
import { Activities } from '../features/activities';
import { Map } from '../features/map';
function ErrorFallback({ error }: { error: Error }) {
  return (
    <Box style={styles.container}>
      <Text style={styles.errorText}>Something went wrong:</Text>
      <Text style={styles.errorMessage}>{error.message}</Text>
    </Box>
  );
}

export default function HomeScreen() {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <GluestackUIProvider config={config}>
        <Box style={styles.container}>
          <VStack style={styles.contentContainer}>
            <SearchByAddressInput />
            <Map />
            <Activities />
          </VStack>
        </Box>
      </GluestackUIProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  activeTourCard: {
    borderColor: '#007AFF',
    borderWidth: 2,
  },
  deleteButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    backgroundColor: '#ff4444',
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButtonText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    lineHeight: 24,
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  mapContainer: {
    flex: 2,
  },
  carouselContainer: {
    flex: 1,
  },
  tourCard: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    margin: 5,
    width: Dimensions.get('window').width - 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    flex: 1,
  },
  tourTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  activitiesList: {
    gap: 8,
  },
  activityItem: {
    padding: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 5,
  },
  activityName: {
    fontSize: 16,
    fontWeight: '600',
  },
  activityDescription: {
    fontSize: 14,
    color: '#666',
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ff0000',
  },
  errorMessage: {
    marginTop: 8,
    color: '#ff0000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  contentContainer: {
    flex: 1,
  },
  contentRow: {
    flex: 1,
  },
});
