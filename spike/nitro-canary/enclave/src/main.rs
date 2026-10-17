//! canary-enclave: listens on vsock port 5005 inside a Nitro Enclave.
//!
//! Request (one JSON line):
//!   {"nonce":"0x..","userData":"0x..","chainId":80002,"canary":"0x..",
//!    "contestId":"1","away":30,"home":23}
//! Response (one JSON line):
//!   {"attestation":"0x..","signer":"0x..","digest":"0x..","signature":"0x.."}
//!
//! The digest matches NitroCanary.scoreDigest:
//!   keccak256(abi.encode(keccak256("ospex.nitro-canary.score.v1"), chainId, canary,
//!                        contestId, away, home))
use std::io::{BufRead, BufReader, Write};

use aws_nitro_enclaves_nsm_api::{
    api::{Request, Response},
    driver::{nsm_init, nsm_process_request},
};
use k256::ecdsa::SigningKey;
use serde::Deserialize;
use serde_bytes::ByteBuf;
use sha3::{Digest, Keccak256};
use vsock::{VsockAddr, VsockListener, VMADDR_CID_ANY};

const PORT: u32 = 5005;
/// Build-time marker. A different value is a different image, with different PCRs.
const VARIANT: &str = env!("CANARY_VARIANT");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Req {
    nonce: String,
    user_data: String,
    chain_id: u64,
    canary: String,
    contest_id: String,
    away: u32,
    home: u32,
}

fn unhex(s: &str) -> Vec<u8> {
    hex::decode(s.trim_start_matches("0x")).expect("hex")
}

fn word_u64(n: u64) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[24..].copy_from_slice(&n.to_be_bytes());
    w
}

fn keccak(data: &[u8]) -> [u8; 32] {
    Keccak256::digest(data).into()
}

fn score_digest(r: &Req) -> [u8; 32] {
    let mut enc = Vec::with_capacity(6 * 32);
    enc.extend(keccak(b"ospex.nitro-canary.score.v1"));
    enc.extend(word_u64(r.chain_id));
    let mut addr = [0u8; 32];
    addr[12..].copy_from_slice(&unhex(&r.canary));
    enc.extend(addr);
    enc.extend(word_u64(r.contest_id.parse().expect("contestId")));
    enc.extend(word_u64(r.away as u64));
    enc.extend(word_u64(r.home as u64));
    keccak(&enc)
}

fn nsm_random(fd: i32) -> Vec<u8> {
    match nsm_process_request(fd, Request::GetRandom) {
        Response::GetRandom { random } => random,
        other => panic!("GetRandom: {other:?}"),
    }
}

fn main() {
    let fd = nsm_init();
    assert!(fd >= 0, "no NSM device");

    // One key per boot, from the NSM's own randomness.
    let mut seed = nsm_random(fd);
    seed.truncate(32);
    let key = SigningKey::from_slice(&seed).expect("key");
    let point = key.verifying_key().to_encoded_point(false);
    let public_key = point.as_bytes().to_vec(); // 0x04 || X || Y, 65 bytes
    let signer = &keccak(&public_key[1..])[12..];
    eprintln!("canary-enclave {VARIANT} signer 0x{}", hex::encode(signer));

    let listener = VsockListener::bind(&VsockAddr::new(VMADDR_CID_ANY, PORT)).expect("bind");
    for conn in listener.incoming() {
        let mut stream = match conn {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut line = String::new();
        if BufReader::new(&stream).read_line(&mut line).is_err() {
            continue;
        }
        let req: Req = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let _ = writeln!(stream, "{{\"error\":\"{e}\"}}");
                continue;
            }
        };
        let digest = score_digest(&req);
        let (sig, recid) = key.sign_prehash_recoverable(&digest).expect("sign");
        let mut signature = sig.to_bytes().to_vec();
        signature.push(27 + recid.to_byte());

        let document = match nsm_process_request(
            fd,
            Request::Attestation {
                user_data: Some(ByteBuf::from(unhex(&req.user_data))),
                nonce: Some(ByteBuf::from(unhex(&req.nonce))),
                public_key: Some(ByteBuf::from(public_key.clone())),
            },
        ) {
            Response::Attestation { document } => document,
            other => {
                let _ = writeln!(stream, "{{\"error\":\"{other:?}\"}}");
                continue;
            }
        };

        let _ = writeln!(
            stream,
            "{{\"variant\":\"{VARIANT}\",\"attestation\":\"0x{}\",\"signer\":\"0x{}\",\"digest\":\"0x{}\",\"signature\":\"0x{}\"}}",
            hex::encode(&document),
            hex::encode(signer),
            hex::encode(digest),
            hex::encode(&signature)
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

    fn req() -> Req {
        Req {
            nonce: "0x00".into(),
            user_data: "0x00".into(),
            chain_id: 80002,
            canary: "0x36C02dA8a0983159322a80FFE9F24b1acfF8B570".into(),
            contest_id: "1".into(),
            away: 30,
            home: 23,
        }
    }

    /// Same value as `cast keccak (cast abi-encode ...)` over the canary's scoreDigest fields.
    #[test]
    fn digest_matches_the_canary() {
        assert_eq!(
            hex::encode(score_digest(&req())),
            "d1228ea52b553b9545004a5f4d01fb405077f2c93fd87ee9f324066618159306"
        );
    }

    /// The 65-byte signature recovers to the key's Ethereum address, as ecrecover will.
    #[test]
    fn signature_recovers_to_the_address() {
        let mut k = [0u8; 32];
        k[31] = 7;
        let key = SigningKey::from_slice(&k).unwrap();
        let digest = score_digest(&req());
        let (sig, recid) = key.sign_prehash_recoverable(&digest).unwrap();
        let mut bytes = sig.to_bytes().to_vec();
        bytes.push(27 + recid.to_byte());
        let sig2 = Signature::from_slice(&bytes[..64]).unwrap();
        assert!(sig2.normalize_s().is_none(), "low-s");
        let vk = VerifyingKey::recover_from_prehash(&digest, &sig2, RecoveryId::from_byte(bytes[64] - 27).unwrap()).unwrap();
        let point = vk.to_encoded_point(false);
        let addr = &keccak(&point.as_bytes()[1..])[12..];
        assert_eq!(hex::encode(addr), "d41c057fd1c78805aac12b0a94a405c0461a6fbb");
    }
}
