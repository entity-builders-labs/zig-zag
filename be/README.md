# Tour Planning API

## Overview

A sophisticated tour planning system that leverages AI to create personalized tour itineraries. The system uses LangChain and OpenAI to analyze activities and create optimized tour routes based on various factors including location, time, and user preferences.

## Features

- AI-powered tour generation using GPT-4 and LangChain
- Geospatial activity search and optimization
- Smart activity sequencing considering time and distance
- Vector embeddings for semantic activity matching
- RESTful API endpoints for tour management
- Prisma ORM for database operations
- Comprehensive activity management system

## Tech Stack

- NestJS - Backend framework
- PostgreSQL - Database
- Prisma - ORM
- LangChain - AI/LLM framework
- OpenAI - GPT-4 integration
- TypeScript - Programming language

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL
- OpenAI API key
- pnpm (recommended) or npm

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd backend
```

2. Install dependencies:

```bash
pnpm install
```

3. Set up environment variables:
   Create a .env file with the following variables:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/database"
OPENAI_API_KEY="your-api-key"
PORT=3000
```

4. Run database migrations:

```bash
pnpm prisma migrate dev
```

5. Start the development server:

```bash
pnpm run start:dev
```

## API Endpoints

### Tours

#### Create AI Tour

```http
POST /tours/ai
```

Creates a tour using AI with the following parameters:

- `latitude`: number
- `longitude`: number

#### Create Manual Tour

```http
POST /tours
```

Manually create a tour with specific activities and details.

#### Get Tours

```http
GET /tours
```

Retrieve all tours with pagination support.

#### Get Tour by ID

```http
GET /tours/:id
```

Get detailed information about a specific tour.

### Activities

#### Create Activity

```http
POST /activities
```

Create a new activity in the system.

#### Get Activities

```http
GET /activities
```

Get activities with optional filtering by location and distance.

## AI Tour Generation

The system uses a sophisticated AI pipeline for tour generation:

1. **Activity Selection**: Uses vector embeddings to find relevant activities based on location and context.
2. **Sequence Optimization**: Arranges activities in an optimal sequence considering:
   - Geographic proximity
   - Time of day
   - Activity duration
   - Travel time between locations
3. **Tour Customization**: Adjusts tours based on:
   - Group size
   - Activity types
   - Time constraints
   - Weather conditions

## Development

### Project Structure

```
src/
├── activities/       # Activity management
├── tours/           # Tour management
├── prisma/          # Database schema and migrations
├── config/          # Configuration files
└── main.ts          # Application entry point
```

### Database Schema

The main entities in the system are:

- **Tour**: Represents a complete tour itinerary
- **Activity**: Individual activities or attractions
- **TourActivity**: Junction table linking tours and activities

### Adding New Features

1. Create a new module:

```bash
nest generate module feature-name
```

2. Generate required components:

```bash
nest generate controller feature-name
nest generate service feature-name
```

## Testing

Run the test suite:

```bash
pnpm test
```

Run e2e tests:

```bash
pnpm test:e2e
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## TODO

1. Users can hide activities from search results
2. Users can create activities
3. Users can create tours and modify them.
