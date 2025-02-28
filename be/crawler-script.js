const axios = require('axios');

// Center point coordinates
const CENTER_LAT = -34.509615;
const CENTER_LNG = -58.4029432;
const RADIUS_KM = 5; // Radius in kilometers
const NUM_POINTS = 10; // Number of points to generate
const DELAY_MS = 3000; // Delay between requests in milliseconds

// Function to generate a random coordinate within a radius
function generateRandomCoordinate(centerLat, centerLng, radiusKm) {
  // Earth's radius in kilometers
  const earthRadius = 6371;

  // Convert radius from kilometers to radians
  const radiusRadians = radiusKm / earthRadius;

  // Generate a random distance within the radius
  const randomDistance = Math.random() * radiusRadians;

  // Generate a random angle in radians
  const randomAngle = Math.random() * 2 * Math.PI;

  // Calculate offset from center
  const latOffset = randomDistance * Math.cos(randomAngle);
  const lngOffset =
    (randomDistance * Math.sin(randomAngle)) /
    Math.cos((centerLat * Math.PI) / 180);

  // Convert to degrees
  const newLat = centerLat + (latOffset * 180) / Math.PI;
  const newLng = centerLng + (lngOffset * 180) / Math.PI;

  return { latitude: newLat, longitude: newLng };
}

// Function to make a POST request to the crawler
async function makeCrawlerRequest(coordinate) {
  const url = 'http://localhost:3000/crawlers/google-maps/crawl';
  const payload = {
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    radius: 1000, // Using 1000m radius for each search
  };

  console.log(
    `Making request for coordinates: Lat ${coordinate.latitude.toFixed(7)}, Lng ${coordinate.longitude.toFixed(7)}`,
  );

  try {
    const response = await axios.post(url, payload);
    console.log(
      `SUCCESS! Added ${response.data.length} activities. IDs: ${response.data.join(', ')}`,
    );
    return response.data;
  } catch (error) {
    console.error(`ERROR making request: ${error.message}`);
    if (error.response) {
      console.error(
        `Status: ${error.response.status}, Data:`,
        error.response.data,
      );
    }
    return null;
  }
}

// Function to add delay between requests
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Main function to run the crawler
async function runCrawler() {
  console.log(
    `Starting crawler with center point: Lat ${CENTER_LAT}, Lng ${CENTER_LNG}`,
  );
  console.log(
    `Generating ${NUM_POINTS} coordinates within ${RADIUS_KM}km radius`,
  );

  // Generate coordinates
  const coordinates = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    coordinates.push(
      generateRandomCoordinate(CENTER_LAT, CENTER_LNG, RADIUS_KM),
    );
  }

  // Log all coordinates
  console.log('Generated coordinates:');
  coordinates.forEach((coord, index) => {
    console.log(
      `${index + 1}. Lat: ${coord.latitude.toFixed(7)}, Lng: ${coord.longitude.toFixed(7)}`,
    );
  });

  // Make requests with delay
  console.log('\nStarting requests with delay of', DELAY_MS, 'ms between each');
  let totalSuccess = 0;
  let totalActivities = 0;

  for (let i = 0; i < coordinates.length; i++) {
    const result = await makeCrawlerRequest(coordinates[i]);

    if (result) {
      totalSuccess++;
      totalActivities += result.length;
    }

    // Add delay before next request (except after the last one)
    if (i < coordinates.length - 1) {
      console.log(`Waiting ${DELAY_MS}ms before next request...`);
      await delay(DELAY_MS);
    }
  }

  // Print summary
  console.log('\n--- CRAWLER SUMMARY ---');
  console.log(`Total requests: ${coordinates.length}`);
  console.log(`Successful requests: ${totalSuccess}`);
  console.log(`Failed requests: ${coordinates.length - totalSuccess}`);
  console.log(`Total activities found: ${totalActivities}`);
  console.log('----------------------');
}

// Run the crawler
runCrawler().catch((error) => {
  console.error('Error in crawler execution:', error);
});
