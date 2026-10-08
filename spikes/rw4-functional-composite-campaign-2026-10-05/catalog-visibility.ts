import { ConfigService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/node_modules/@nestjs/config';
import { PrismaService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/core/database/prisma.service';
import { ExperienceCatalogService } from '/Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign/be/src/modules/tours/services/experience-catalog.service';
(async () => {
  const prisma = new PrismaService(new ConfigService({}));
  const catalog = new ExperienceCatalogService(prisma as any, { getStatus: () => ({ provider: 'none' }) } as any);
  const rows = await catalog.findVerifiedWithinForMatching(-34.6037, -58.3816, 13420);
  for (const row of rows as any[]) {
    if ((row.components?.length ?? 0) > 1 || row.compositionCompleteness === 'PARTIAL')
      console.log(row.id, '|', row.canonicalName, '|', row.compositionCompleteness, '| navigable', row.components.map((c: any) => c.name ?? c.geoEntity?.name).join(', '), '| unresolved', row.sourceComposition?.unresolvedMembers?.length);
  }
  console.log('total rows', rows.length);
  await prisma.$disconnect();
})();
