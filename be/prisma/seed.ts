// @ts-nocheck
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // First create known activity types
  const knownActivityTypes = [
    {
      name: 'Hiking',
      description: 'Outdoor walking and trekking activities',
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

  // Create activities one by one to handle duplicates
  for (const type of knownActivityTypes) {
    try {
      await prisma.knownActivityType.create({
        data: type,
      });
    } catch (error) {
      if (error.code !== 'P2002') {
        // Skip unique constraint violations
        throw error;
      }
    }
  }

  // Create a default source
  const defaultSource = await prisma.source.create({
    data: {
      name: 'Default Source',
      type: 'MANUAL',
    },
  });

  // Now you can create activities that reference this source
  // Example activity creation:
  try {
    await prisma.activity.create({
      data: {
        name: 'Sample Hiking Trail',
        description: 'A beautiful hiking trail',
        difficulty: Difficulty.EASY,
        type: 'Hiking',
        duration: 2.5,
        price: 0,
        maxGroupSize: 10,
        latitude: 40.7128,
        longitude: -74.006,
        location: {
          type: 'Point',
          coordinates: [-74.006, 40.7128],
        },
        sourceId: defaultSource.id,
        externalId: 'sample-1',
      },
    });
  } catch (error) {
    if (error.code !== 'P2002') {
      throw error;
    }
  }

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
