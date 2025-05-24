# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies including TypeScript types
RUN yarn install
RUN yarn add --dev @types/react-native

# Install Expo CLI globally
RUN yarn global add expo-cli

# Copy the rest of the application
COPY . .

# Expose the port the app runs on
EXPOSE 19006

# Command to run the application
CMD ["yarn", "web"] 