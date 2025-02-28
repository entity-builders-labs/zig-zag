import { PrismaClient, Difficulty } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // First create known activity types
  const knownTypes = [
    {
      name: 'Hiking',
      description: 'Walking or trekking through nature trails',
    },
    {
      name: 'Mountain Biking',
      description: 'Off-road cycling on mountain trails',
    },
    {
      name: 'Rock Climbing',
      description: 'Climbing natural rock formations or artificial walls',
    },
    { name: 'Kayaking', description: 'Paddling through waters in a kayak' },
    {
      name: 'Camping',
      description: 'Overnight stays in nature with basic equipment',
    },
    { name: 'Surfing', description: 'Riding ocean waves on a surfboard' },
    {
      name: 'Scuba Diving',
      description: 'Underwater exploration with breathing equipment',
    },
  ];

  console.log('Creating known activity types...');
  await prisma.knownActivityType.createMany({
    data: knownTypes,
    skipDuplicates: true,
  });

  // Then create activities
  const activitiesSeed = [
    {
      name: 'Trek Torres del Paine W Circuit',
      description:
        "Experience one of the world's most famous treks through stunning Patagonian landscapes",
      type: 'Trekking',
      difficulty: Difficulty.HARD,
      duration: 5,
      price: 299.99,
      maxGroupSize: 12,
      latitude: -50.942326,
      longitude: -73.406788,
      location: {
        country: 'Chile',
        region: 'Magallanes',
        formattedAddress: 'Torres del Paine National Park, Chile',
        placeId: 'ChIJXXXXXXXXXXXXXXXXXX',
      },
    },
    {
      name: 'Yosemite Valley Camping Adventure',
      description:
        'Camp under the stars in the heart of Yosemite Valley, surrounded by iconic granite cliffs',
      type: 'Camping',
      difficulty: Difficulty.MEDIUM,
      duration: 3,
      price: 149.99,
      maxGroupSize: 8,
      latitude: 37.7456,
      longitude: -119.5936,
      location: {
        country: 'United States',
        region: 'California',
        formattedAddress: 'Yosemite Valley, Yosemite National Park, CA 95389',
        placeId: 'ChIJxeyK9Z3wloAR_gPRUeC6Eng',
      },
    },
    {
      name: 'Queenstown Mountain Biking',
      description:
        'Tackle world-class mountain biking trails with stunning views of Lake Wakatipu',
      type: 'Mountain Biking',
      difficulty: Difficulty.HARD,
      duration: 4,
      price: 189.99,
      maxGroupSize: 6,
      latitude: -45.031162,
      longitude: 168.662644,
      location: {
        country: 'New Zealand',
        region: 'Otago',
        formattedAddress:
          'Queenstown Mountain Bike Park, Queenstown, New Zealand',
        placeId: 'ChIJ_____________________',
      },
    },
    {
      name: 'Rock Climbing in Kalymnos',
      description:
        'Scale limestone cliffs overlooking the crystal-clear Aegean Sea',
      type: 'Rock Climbing',
      difficulty: Difficulty.HARD,
      duration: 6,
      price: 249.99,
      maxGroupSize: 4,
      latitude: 36.963621,
      longitude: 26.938477,
      location: {
        country: 'Greece',
        region: 'South Aegean',
        formattedAddress: 'Kalymnos Climbing Area, Kalymnos 852 00, Greece',
        placeId: 'ChIJ_____________________',
      },
    },
    {
      name: 'Milford Sound Kayaking Expedition',
      description:
        'Paddle through pristine fiords beneath towering peaks and waterfalls',
      type: 'Kayaking',
      difficulty: Difficulty.MEDIUM,
      duration: 4,
      price: 179.99,
      maxGroupSize: 8,
      latitude: -44.671625,
      longitude: 167.926039,
      location: {
        country: 'New Zealand',
        region: 'Southland',
        formattedAddress: 'Milford Sound, Fiordland National Park, New Zealand',
        placeId: 'ChIJ_____________________',
      },
    },
  ];

  /*   await prisma.activity.createMany({
    data: activitiesSeed,
    skipDuplicates: true,
  });
 */
  console.log('Creating tours...');
  const tours = [
    {
      name: 'Patagonian Adventure',
      description: 'Experience the best of Patagonia',
      startDates: [
        new Date('2024-01-15'),
        new Date('2024-02-15'),
        new Date('2024-03-15'),
      ],
      maxGroupSize: 12,
      price: 2999.99,
      duration: 10,
    },
    {
      name: 'New Zealand Explorer',
      description: 'Discover the natural wonders of New Zealand',
      startDates: [
        new Date('2024-02-01'),
        new Date('2024-03-01'),
        new Date('2024-04-01'),
      ],
      maxGroupSize: 8,
      price: 3499.99,
      duration: 14,
    },
    {
      name: 'Greek Islands Adventure',
      description: 'Island hopping and outdoor activities in Greece',
      startDates: [
        new Date('2024-05-01'),
        new Date('2024-06-01'),
        new Date('2024-07-01'),
      ],
      maxGroupSize: 10,
      price: 1999.99,
      duration: 7,
    },
  ];

  const createdTours = await prisma.$transaction(
    tours.map((tour) => prisma.tour.create({ data: tour })),
  );

  console.log('Creating tour-activity relationships...');
  // Create relationships between tours and activities
  const activities = await prisma.activity.findMany();

  // Link activities to tours based on location proximity
  const tourActivities = createdTours.flatMap((tour) => {
    // Get 2-3 random activities for each tour
    const numActivities = Math.floor(Math.random() * 2) + 2;
    const tourActivities = activities
      .sort(() => Math.random() - 0.5)
      .slice(0, numActivities)
      .map((activity) => ({
        tourId: tour.id,
        activityId: activity.id,
      }));
    return tourActivities;
  });

  await prisma.tourActivity.createMany({
    data: tourActivities,
    skipDuplicates: true,
  });

  console.log('Seeding completed successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
