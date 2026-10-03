import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.source.upsert({
    where: { name: 'Default Source' },
    update: {},
    create: { name: 'Default Source', type: 'MANUAL' },
  });
  console.log('Experience V2 seed completed successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
