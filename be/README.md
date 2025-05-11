# Backend - Tour Planning System

## Description

A tour planning system that uses AI to create personalized itineraries.

## Requirements

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
   Create a `.env` file with:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/database"
OPENAI_API_KEY="your-api-key"
PORT=3000
```

4. Run database migrations:

```bash
pnpm prisma migrate dev
```

5. Generate Prisma Client:

```bash
pnpm prisma generate
```

6. Start the development server:

```bash
pnpm run start:dev
```

## Main Technologies

- NestJS - Backend framework
- PostgreSQL - Database
- Prisma - ORM
- LangChain - AI framework
- OpenAI - GPT-4 integration
- TypeScript - Programming language
