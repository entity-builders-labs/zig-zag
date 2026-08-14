# Built from the repo root (context: ., dockerfile: go-be/Dockerfile),
# mirroring be/Dockerfile's convention so both backends build the same way
# from docker-compose.yml.
FROM golang:1.25-alpine AS build
WORKDIR /app

COPY go-be/go.mod go-be/go.sum ./
RUN go mod download

COPY go-be/ ./
RUN CGO_ENABLED=0 go build -o /bin/api ./cmd/api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /bin/api /usr/local/bin/api

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/api"]
