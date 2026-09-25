# Optional container build for Linux hosts. Windows users run dist\shelf.exe instead.

FROM node:24-alpine AS front
WORKDIR /app
COPY front/package.json front/package-lock.json ./
COPY front/scripts ./scripts
RUN npm ci --no-audit --no-fund
COPY front/ ./
RUN npx farm build

FROM golang:1.24-alpine AS back
WORKDIR /src
COPY back/go.mod back/go.sum ./
RUN go mod download
COPY back/ ./
COPY --from=front /app/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /shelf .

FROM alpine:3.21
RUN apk add --no-cache 7zip poppler-utils
COPY --from=back /shelf /usr/local/bin/shelf
ENV BOOKS_DIR=/books DATA_DIR=/data PORT=50080
EXPOSE 50080
CMD ["shelf", "-log", "-"]
