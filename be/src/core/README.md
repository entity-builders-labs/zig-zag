# Core Module

Foundational infrastructure that all other modules depend on. Must be imported first in `AppModule`.

## Architecture

```
core/
├── config/
│   ├── config.module.ts      # Global ConfigModule setup
│   ├── app.config.ts          # App-wide configuration (defaults, ports)
│   └── database.config.ts     # Database connection config
└── database/
    ├── database.module.ts     # PrismaModule (global)
    └── prisma.service.ts      # PrismaService with lifecycle hooks
```

## Config Module

- Uses `@nestjs/config` with `registerAs()` for typed configuration
- `app.config.ts`: Default location coordinates (Buenos Aires), port, and general app settings
- `database.config.ts`: PostgreSQL connection from `DATABASE_URL` env var
- **Must be imported before `PrismaModule`** so `ConfigService` is available

## Database Module

- `PrismaService` extends Prisma Client and implements `OnModuleInit`
- Connects to PostgreSQL on startup via `$connect()`
- Exported globally — available to all modules without re-importing
