# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy root package files
COPY package.json yarn.lock ./
COPY fe/package.json ./fe/

# Install dependencies including TypeScript types
RUN yarn install --frozen-lockfile
RUN yarn workspace fe add --dev @types/react-native

# Install Expo CLI globally
RUN yarn global add expo-cli

# Copy the rest of the application
COPY . .

# Expose the port the app runs on
EXPOSE 8081

# Command to run the application
CMD ["yarn", "workspace", "fe", "start", "--web", "--host", "localhost"] 