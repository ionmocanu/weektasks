FROM node:20-alpine

WORKDIR /app

# Copy app sources
COPY server.js ./
COPY public ./public

# Persistent data directory (mount a volume here to keep tasks across restarts)
RUN mkdir -p /data
VOLUME ["/data"]

# Default port (override at run time with -e PORT=xxxx and -p xxxx:xxxx)
ENV PORT=3000
ENV DATA_DIR=/data

EXPOSE 3000

CMD ["node", "server.js"]
