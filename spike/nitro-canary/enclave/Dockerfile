# The enclave image. Build on the parent instance (arm64 on Graviton), then
#   nitro-cli build-enclave --docker-uri canary:a --output-file canary-a.eif
# which prints PCR0, PCR1 and PCR2. VARIANT=b builds the "other image" for the negative control.
FROM rust:1.91.1-alpine3.22 AS build
ARG VARIANT=a
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml ./
COPY Cargo.lock* ./
COPY src ./src
RUN CANARY_VARIANT=${VARIANT} cargo build --release

FROM alpine:3.22
COPY --from=build /src/target/release/canary-enclave /canary-enclave
CMD ["/canary-enclave"]
