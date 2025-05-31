# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install all workspace dependencies
RUN yarn install --frozen-lockfile

# Copy the cors-proxy file
COPY cors-proxy.js ./

# Expose the port
EXPOSE 8080

# Command to run the cors proxy
CMD ["node", "cors-proxy.js"]