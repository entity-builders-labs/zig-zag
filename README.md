# Zig-Zag

A modern travel and exploration application that helps users discover places and activities using AI-powered recommendations.

## Project Structure

The project is divided into two main parts:

- `be/` - Backend service (NestJS)
- `fe/` - Frontend mobile application (React Native with Expo)

## Prerequisites

- Node.js (v18 or higher)
- Yarn package manager
- Docker and Docker Compose
- Google Maps API key
- OpenAI API key (optional, for AI features)
- Expo CLI
- iOS Simulator (for iOS development)
- Android Studio (for Android development)

### Setup

1. Install dependencies from the root directory:

```bash
yarn install
```

2. Set up environment variables (optional for local development):
   Create a `.env` file in the root directory with the following variables:

```env
# Database: PostgreSQL local is used automatically in Docker Compose
# Only set these if you want to use Supabase locally
# DATABASE_URL=postgresql://postgres:password@localhost:5432/zigzag

# ChromaDB (local Docker container)
CHROMA_URL=http://localhost:8001

# Google Maps
GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# OpenAI (optional)
OPENAI_API_KEY=your_openai_api_key
```

**Note:** For local development, Docker Compose automatically uses a local PostgreSQL container. You don't need to configure `DATABASE_URL` unless you want to use Supabase locally.

3. Start the services:

```bash
# Start all services (PostgreSQL, Backend, Frontend, ChromaDB, Ollama)
docker-compose up -d

# Or start in foreground to see logs
docker-compose up
```

4. Initialize the database (runs automatically on first start):

The database setup script runs automatically when the backend starts. If you need to run it manually:

```bash
docker-compose exec backend yarn prisma:setup
```

5. (Optional) Execute the first crawl of places manually:

```bash
docker-compose exec backend yarn crawl
```

### Available Scripts

From the root directory:

- `yarn start` - Start both backend and frontend in development mode
- `yarn start:be` - Start only the backend server
- `yarn start:fe` - Start only the frontend development server
- `yarn build` - Build both backend and frontend
- `yarn test` - Run tests for both backend and frontend
- `yarn crawl` - Run the crawler script to gather location data
- `yarn seed` - Seed the database with initial data

Frontend specific scripts:

- `yarn ios` - Run on iOS simulator
- `yarn android` - Run on Android emulator
- `yarn web` - Run in web browser
- `yarn eas-build` - Build for iOS development

### Features

- RESTful API endpoints
- Google Places integration
- AI-powered recommendations using LangChain
- Vector database integration with ChromaDB
- Data crawling capabilities
- Swagger API documentation
- PostgreSQL database (local in development, Supabase in production)

## Development

### Code Style

- The project uses ESLint and Prettier for code formatting
- TypeScript is used throughout the project
- Follow the existing code style and patterns

### Testing

- Backend: Jest for unit and e2e testing
- Frontend: React Native Testing Library (recommended)

## Deployment

### Backend

For detailed deployment instructions, see [DEPLOY.md](./DEPLOY.md)

**Quick summary:**
- **Development:** Uses local PostgreSQL in Docker Compose (automatic)
- **Production (Fly.io):** Uses Supabase (configure `DATABASE_URL` in Fly.io secrets)

**Deploy to Fly.io:**

1. Configure Supabase and set environment variables:
   ```bash
   fly secrets set DATABASE_URL="postgresql://..." --app zig-zag-backend
   ```

2. Deploy:
   ```bash
   fly deploy
   ```

See [DEPLOY.md](./DEPLOY.md) and [ENVIRONMENTS.md](./ENVIRONMENTS.md) for complete instructions.

### Frontend

1. Build using EAS:

```bash
yarn eas-build
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is private and unlicensed.

## Support

For support, please open an issue in the repository.

# 1. Crear el archivo .env con las variables

# 2. Aplicar los cambios al script init-replica.js

# 3. Ejecutar el setup:

chmod +x setup.sh
./setup.sh

# O manualmente:

docker-compose down
docker-compose up -d mongodb

# Esperar 30-60 segundos

docker-compose up -d

# Ver logs de MongoDB

docker-compose logs mongodb

# Verificar que los usuarios se crearon

docker-compose exec mongodb mongosh --authenticationDatabase admin -u admin -p password123

# En mongosh:

use zigzag
db.getUsers()

# Probar conexión desde el backend

docker-compose exec backend env | grep MONGO
