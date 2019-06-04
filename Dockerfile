ARG RUNTIME=nodejs10.x

FROM lambci/lambda:build-${RUNTIME}
COPY . .
RUN npm install
RUN npm test
RUN npm pack
