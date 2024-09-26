FROM node:22-alpine

RUN apk add --no-cache bash tini

EXPOSE 3000

ENV CRANLIKE_MONGODB_SERVER="mongo" \
    VCAP_APP_HOST="0.0.0.0"

COPY . /cdn-app

WORKDIR /cdn-app

RUN npm install .

ENTRYPOINT [ "tini", "--", "/cdn-app/entrypoint.sh"]
