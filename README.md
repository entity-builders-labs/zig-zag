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
- AWS DynamoDB (local or cloud)
- Google Maps API key
- OpenAI API key
- Expo CLI
- iOS Simulator (for iOS development)
- Android Studio (for Android development)

### Setup

1. Install dependencies from the root directory:

```bash
yarn install
```

2. Set up environment variables:
   Create a `.env` file in the root directory with the following variables:

```env
DYNAMODB_ENDPOINT="http://localhost:8000"  # For local development
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="your_access_key"
AWS_SECRET_ACCESS_KEY="your_secret_key"
GOOGLE_MAPS_API_KEY="your_google_maps_api_key"
OPENAI_API_KEY="your_openai_api_key"
```

3. Start the local DynamoDB container:

```bash
docker-compose up -d

// Execute the first crawl of places manually
docker-compose exec backend yarn crawl
```

4. Initialize the database:

```bash
yarn seed
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
