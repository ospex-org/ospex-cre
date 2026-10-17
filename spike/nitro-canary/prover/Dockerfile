# x86_64 only: RISC Zero's Groth16 step runs its own x86 prover image through Docker.
FROM rust:1.91.1-bookworm

# Docker CLI only (the daemon is the host's, reached through the mounted socket).
RUN curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz \
    | tar -xz -C /usr/local/bin --strip-components=1 docker/docker

WORKDIR /src
COPY Cargo.toml ./
COPY Cargo.lock* ./
COPY src ./src
RUN cargo build --release --locked || cargo build --release

ENTRYPOINT ["/src/target/release/nitro-zk-prove"]
