# Stage 1: build React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY whatsy-frontend/package*.json ./
RUN npm ci
COPY whatsy-frontend/ ./
RUN npm run build

# Stage 2: build Go backend
FROM golang:1.23-alpine AS backend-builder
WORKDIR /app
COPY whatsy-backend/go.mod whatsy-backend/go.sum ./
RUN go mod download
COPY whatsy-backend/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/server

# Stage 3: final image
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend-builder /app/server .
COPY --from=backend-builder /app/migrations ./migrations
COPY --from=frontend-builder /frontend/dist ./public
EXPOSE 8080
CMD ["./server"]
