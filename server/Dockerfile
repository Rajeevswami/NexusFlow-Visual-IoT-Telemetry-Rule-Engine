FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
USER node
EXPOSE 5000
CMD ["npm", "start"]
