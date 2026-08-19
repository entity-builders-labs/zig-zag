import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActivityKind, VariantTheme } from '@prisma/client';
import { CreateActivityDto } from './create-activity.dto';

// Composite activities (Fase 1): validates the new optional fields added to
// support the Area/Family/Variant model — kind/variantTheme/boundary/
// isCurated/isArchived/familyId. Nothing in the app writes these yet; this
// only locks down that the DTO accepts/rejects the right shapes.
describe('CreateActivityDto (composite activities fields)', () => {
  const base = { name: 'San Telmo Historic Walk' };

  it('accepts a minimal DTO without any of the new fields (default POI)', async () => {
    const dto = plainToInstance(CreateActivityDto, base);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid kind', async () => {
    const dto = plainToInstance(CreateActivityDto, {
      ...base,
      kind: ActivityKind.NEIGHBORHOOD_WALK,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid kind', async () => {
    const dto = plainToInstance(CreateActivityDto, {
      ...base,
      kind: 'NOT_A_REAL_KIND',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'kind')).toBe(true);
  });

  it('accepts a valid variantTheme', async () => {
    const dto = plainToInstance(CreateActivityDto, {
      ...base,
      variantTheme: VariantTheme.HISTORY,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid variantTheme', async () => {
    const dto = plainToInstance(CreateActivityDto, {
      ...base,
      variantTheme: 'NOT_A_REAL_THEME',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'variantTheme')).toBe(true);
  });

  it('accepts a GeoJSON boundary object', async () => {
    const dto = plainToInstance(CreateActivityDto, {
      ...base,
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts isCurated/isArchived booleans', async () => {
    const dto = plainToInstance(CreateActivityDto, {
      ...base,
      isCurated: true,
      isArchived: false,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-boolean isCurated', async () => {
    const dto = plainToInstance(CreateActivityDto, {
      ...base,
      isCurated: 'yes',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'isCurated')).toBe(true);
  });

  it('accepts a familyId string', async () => {
    const dto = plainToInstance(CreateActivityDto, {
      ...base,
      familyId: '11111111-1111-1111-1111-111111111111',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
