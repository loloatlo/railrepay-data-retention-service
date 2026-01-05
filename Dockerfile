# Multi-stage Dockerfile for data-retention-service
# Railway deployment configuration

# Stage 1: Build
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:18-alpine AS production

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --only=production

# Copy build artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Copy migrations (needed for database setup)
COPY migrations ./migrations
COPY .migrationrc.json ./

# Set environment to production
ENV NODE_ENV=production

# Expose health check port
EXPOSE 3000

# Run the service
CMD ["node", "dist/index.js"]
