FROM node:20

WORKDIR /app

COPY . /app

RUN npm i

CMD npm run server
