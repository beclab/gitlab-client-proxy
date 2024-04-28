FROM node

COPY . /src/

WORKDIR src

RUN npm install
RUN npm i -g ts-node

CMD npm run dev