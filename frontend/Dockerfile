FROM node:20

WORKDIR /app

COPY . .

RUN npm install && npm run build

EXPOSE 3000
ENV HOST=0.0.0.0

# Serve using a basic static server
RUN npm install -g serve
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]