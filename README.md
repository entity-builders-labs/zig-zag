# Zig-Zag

A modern travel and exploration application that helps users discover places and activities using AI-powered recommendations.

## Project Structure

The project is divided into two main parts:

- `be/` - Backend service (NestJS)
- `fe/` - Frontend mobile application (React Native with Expo)

## Backend (NestJS)

### Prerequisites

- Node.js (v18 or higher)
- Yarn package manager
- PostgreSQL database
- Google Maps API key
- OpenAI API key

### Setup

1. Navigate to the backend directory:

```bash
cd be
```

2. Install dependencies:

```bash
yarn install
```

3. Set up environment variables:
   Create a `.env` file with the following variables:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/zigzag"
GOOGLE_MAPS_API_KEY="your_google_maps_api_key"
OPENAI_API_KEY="your_openai_api_key"
```

4. Initialize the database:

```bash
npx prisma migrate dev
yarn seed
```

### Available Scripts

- `yarn start` - Start the server
- `yarn start:dev` - Start the server in development mode with hot-reload
- `yarn build` - Build the application
- `yarn test` - Run tests
- `yarn crawl` - Run the crawler script to gather location data
- `yarn seed` - Seed the database with initial data

### Features

- RESTful API endpoints
- Google Places integration
- AI-powered recommendations using LangChain
- Vector database integration with ChromaDB
- Data crawling capabilities
- Swagger API documentation

## Frontend (React Native)

### Prerequisites

- Node.js (v18 or higher)
- Yarn package manager
- Expo CLI
- iOS Simulator (for iOS development)
- Android Studio (for Android development)

### Setup

1. Navigate to the frontend directory:

```bash
cd fe
```

2. Install dependencies:

```bash
yarn install
```

3. Start the development server:

```bash
yarn start
```

### Available Scripts

- `yarn start` - Start the Expo development server
- `yarn ios` - Run on iOS simulator
- `yarn android` - Run on Android emulator
- `yarn web` - Run in web browser
- `yarn eas-build` - Build for iOS development

### Features

- Modern UI with Gluestack UI components
- Native maps integration
- Location services
- Bottom sheet navigation
- Carousel components
- Google Places autocomplete
- Offline support with AsyncStorage
- Tailwind CSS styling

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

1. Build the application:

```bash
yarn build
```

2. Start in production mode:

```bash
yarn start:prod
```

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
