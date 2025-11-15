FROM node:24-alpine

WORKDIR /max_bot_228kostiley

COPY package*.json ./
RUN npm ci

COPY . .

CMD ["node", "bot.js"]
