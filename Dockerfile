ARG RUNTIME=nodejs10.x

FROM lambci/lambda:build-${RUNTIME} AS build
COPY . .
RUN npm install
RUN npm pack

FROM lambci/lambda:build-${RUNTIME} AS test
COPY --from=build /var/task/ .
RUN npm test
