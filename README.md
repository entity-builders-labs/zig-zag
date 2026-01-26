# Zig-Zag

A modern travel and exploration application that helps users discover places and activities using AI-powered recommendations.

## Project Structure

- `be/` - Backend service (NestJS)
- `fe/` - Frontend mobile application (React Native with Expo)

## Prerequisites

- Node.js (v18+)
- Yarn
- Docker & Docker Compose
- Google Maps API key
- Expo CLI

## Setup

1. **Install dependencies**

   ```bash
   yarn install
   ```

2. **Environment Configuration**
   Copy the example environment file and fill in your values. The example file matches the current project configuration.

   ```bash
   cp .env.example .env
   ```

   _See `.env.example` for comments and details on each variable._

3. **Start Services**

   ```bash
   docker-compose up -d
   ```

   This command starts the following services:

   - **PostgreSQL**: Local database (Development)
   - **Backend**: NestJS API
   - **Frontend**: Expo/React Native server
   - **ChromaDB**: Vector database for AI
   - **Ollama**: Local LLM service

4. **🚀 Quick Start with Simulator** (Recommended)

   To generate the downloadable app for the simulator and start all services in one go, use the build script. This is the **fastest way** to get everything running.

   ```bash
   # Build for iOS Simulator (Default) and start services
   yarn simulator

   # Build for Android Emulator and start services
   yarn simulator:android
   ```

   This will:

   1. Install dependencies.
   2. Build the native app locally.
   3. Install it on your active Simulator/Emulator.
   4. Start Docker Compose (with backend, frontend, etc.).

   _Note: Standard `docker-compose up` works too, but you will need to manually install the app on your simulator or use Expo Go._

5. **Initialize Database**
   Database migrations and setup are handled automatically when the backend starts.

## Available Scripts

- `yarn simulator` - **(Recommended)** Build for iOS Simulator + Start Stack
- `yarn simulator:android` - Build for Android Emulator + Start Stack
- `yarn start` - Run full stack in development mode
- `yarn start:be` - Run backend only
- `yarn start:fe` - Run frontend only
- `yarn test` - Run tests
- `yarn crawl` - Run location crawler
- `yarn eas-build` - Build for iOS (Frontend)

## Deployment

See [DEPLOY.md](./DEPLOY.md) for detailed production deployment instructions (Fly.io).

## License

Private and unlicensed.
