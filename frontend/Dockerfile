FROM node:20

WORKDIR /app

COPY . .

RUN npm install && npm run build

# Serve using a basic static server
RUN npm install -g serve
CMD ["serve", "-s", "dist", "-l", "3000"]
