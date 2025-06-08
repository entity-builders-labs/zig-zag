# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy only package files first (for better caching)
COPY package.json yarn.lock ./
COPY fe/package.json ./fe/

# Install dependencies
RUN yarn install --frozen-lockfile --production=false

# Install Expo CLI globally
RUN yarn global add @expo/cli

# Copy only necessary frontend files
COPY fe/ ./fe/

# Remove unnecessary files
RUN rm -rf fe/ios/build fe/ios/Pods fe/android/build fe/android/.gradle || true

# Expose the ports the app runs on
EXPOSE 8081 19000 19001 19002

# Set environment variables for hot reload
ENV WATCHPACK_POLLING=true
ENV CHOKIDAR_USEPOLLING=true
ENV CHOKIDAR_INTERVAL=1000
ENV FAST_REFRESH=true
ENV EXPO_USE_FAST_REFRESH=true
ENV EXPO_DEVTOOLS_LISTEN_ADDRESS=0.0.0.0
ENV REACT_NATIVE_PACKAGER_HOSTNAME=0.0.0.0

# Command to run the application
CMD ["yarn", "workspace", "fe", "start", "--web", "--host", "lan", "--dev-client"]