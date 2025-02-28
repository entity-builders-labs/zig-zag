import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting seeding...");

  // Create sources
  const sources = [
    {
      id: "google-maps",
      name: "Google Maps",
      type: "API",
      baseUrl: "https://maps.googleapis.com/",
    },
    {
      id: "manual",
      name: "Manual Entry",
      type: "MANUAL",
      baseUrl: null,
    },
    {
      id: "tripadvisor",
      name: "TripAdvisor",
      type: "CRAWLED",
      baseUrl: "https://www.tripadvisor.com/",
    }
  ];

  for (const source of sources) {
    await prisma.source.upsert({
      where: { id: source.id },
      update: {
        ...source,
        updatedAt: new Date(),
      },
      create: {
        ...source,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    console.log(`Source created: ${source.name} (${source.id})`);
  }

  console.log("Seeding completed!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
