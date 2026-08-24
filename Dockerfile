# Stage 1: Build the Go binary
FROM golang:1.23-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/bin/server cmd/server/main.go

# Stage 2: Minimal runtime image
FROM alpine:3.19

WORKDIR /app

RUN apk --no-cache add ca-certificates tzdata

COPY --from=builder /app/bin/server /app/server
COPY backend/migrations /app/backend/migrations

EXPOSE 8080 10000

CMD ["/app/server"]
