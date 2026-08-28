# Фронт собирается в образе (oven/bun): прод-хост без node/bun.
FROM oven/bun:1 AS web
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ .
RUN bun run build

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ .
RUN CGO_ENABLED=0 go build -o /office . && CGO_ENABLED=0 go build -o /office-secretary ./cmd/secretary

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /office /usr/local/bin/office
COPY --from=build /office-secretary /usr/local/bin/office-secretary
# web_dir в config.yaml указывает сюда (абсолютный путь в образе).
COPY --from=web /web/dist /usr/share/office/web-dist
ENTRYPOINT ["office"]
