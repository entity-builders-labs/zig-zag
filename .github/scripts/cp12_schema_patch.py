from pathlib import Path

schema = Path('be/prisma/schema.prisma')
text = schema.read_text()

if 'model CatalogPopulationJob {' not in text:
    anchor = 'model NegativeMediaLookup {'
    model = '''model CatalogPopulationJob {
  id             String   @id @default(uuid())
  idempotencyKey String   @unique
  requestedById  String
  scope          Json
  themes         String[] @default([])
  intents        String[] @default([])
  status         String   @default("PENDING")
  attemptCount   Int      @default(0)
  maxAttempts    Int      @default(5)
  beforeCount    Int      @default(0)
  afterCount     Int      @default(0)
  createdCount   Int      @default(0)
  reusedCount    Int      @default(0)
  lastError      String?
  trace          Json?
  startedAt      DateTime?
  completedAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([status, createdAt])
  @@index([requestedById])
  @@map("catalog_population_job")
}

'''
    if anchor not in text:
        raise SystemExit('schema anchor for CatalogPopulationJob not found')
    text = text.replace(anchor, model + anchor, 1)
    schema.write_text(text)
