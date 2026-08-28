FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /office . && CGO_ENABLED=0 go build -o /office-secretary ./cmd/secretary

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /office /usr/local/bin/office
COPY --from=build /office-secretary /usr/local/bin/office-secretary
ENTRYPOINT ["office"]
