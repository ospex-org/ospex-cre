//! nitro-zk-prove <execute|prove> <guest.elf> <attestation> <trusted-prefix-len> <out-dir>
//!
//! `execute` runs the guest once (no proof) and reports its cycles and journal.
//! `prove` makes a Groth16 proof on this machine. The Groth16 step runs RISC Zero's prover
//! image through Docker; set RISC0_WORK_DIR to a directory the Docker daemon can mount.
use std::{fs, path::PathBuf, time::Instant};

use anyhow::{bail, Context, Result};
use risc0_zkvm::{
    compute_image_id, default_executor, default_prover, sha::Digestible, ExecutorEnv,
    Groth16ReceiptVerifierParameters, ProverOpts,
};

fn word(n: usize) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[24..].copy_from_slice(&(n as u64).to_be_bytes());
    w
}

/// abi.encode(VerifierInput{uint8 trustedCertsPrefixLen; bytes attestationReport}),
/// the bytes the guest reads from stdin and decodes with VerifierInput::abi_decode.
fn verifier_input(prefix: u8, report: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(160 + report.len());
    out.extend(word(0x20));
    out.extend(word(prefix as usize));
    out.extend(word(0x40));
    out.extend(word(report.len()));
    out.extend(report);
    out.extend(vec![0u8; (32 - report.len() % 32) % 32]);
    out
}

/// An attestation file is either the raw COSE bytes or 0x-prefixed hex text.
fn read_report(path: &str) -> Result<Vec<u8>> {
    let raw = fs::read(path).with_context(|| format!("read {path}"))?;
    let text = String::from_utf8_lossy(&raw);
    let t = text.trim();
    if let Some(h) = t.strip_prefix("0x") {
        if h.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(hex::decode(h)?);
        }
    }
    Ok(raw)
}

fn main() -> Result<()> {
    let a: Vec<String> = std::env::args().collect();
    if a.len() != 6 {
        bail!("usage: nitro-zk-prove <execute|prove> <guest.elf> <attestation> <trusted-prefix-len> <out-dir>");
    }
    let elf = fs::read(&a[2]).context("read guest ELF")?;
    let report = read_report(&a[3])?;
    let prefix: u8 = a[4].parse().context("trusted-prefix-len")?;
    let out = PathBuf::from(&a[5]);
    fs::create_dir_all(&out)?;

    let image_id = compute_image_id(&elf)?;
    let input = verifier_input(prefix, &report);
    let env = ExecutorEnv::builder().write_slice(&input).build()?;
    let started = Instant::now();

    match a[1].as_str() {
        "execute" => {
            let session = default_executor().execute(env, &elf)?;
            let user_cycles: u64 = session.segments.iter().map(|s| s.cycles as u64).sum();
            let padded_cycles: u64 = session.segments.iter().map(|s| 1u64 << s.po2).sum();
            fs::write(out.join("journal.hex"), hex::encode(&session.journal.bytes))?;
            println!(
                "{{\"mode\":\"execute\",\"imageId\":\"0x{}\",\"exitCode\":\"{:?}\",\"segments\":{},\"userCycles\":{},\"paddedCycles\":{},\"seconds\":{:.1}}}",
                hex::encode(image_id.as_bytes()),
                session.exit_code,
                session.segments.len(),
                user_cycles,
                padded_cycles,
                started.elapsed().as_secs_f64()
            );
        }
        "prove" => {
            let info = default_prover().prove_with_opts(env, &elf, &ProverOpts::groth16())?;
            let seconds = started.elapsed().as_secs_f64();
            info.receipt.verify(image_id).context("receipt does not verify")?;
            let groth16 = info.receipt.inner.groth16().context("not a Groth16 receipt")?;
            let params = Groth16ReceiptVerifierParameters::default().digest();
            let mut seal = params.as_bytes()[..4].to_vec();
            seal.extend_from_slice(&groth16.seal);
            fs::write(out.join("seal.hex"), hex::encode(&seal))?;
            fs::write(out.join("journal.hex"), hex::encode(&info.receipt.journal.bytes))?;
            println!(
                "{{\"mode\":\"prove\",\"imageId\":\"0x{}\",\"selector\":\"0x{}\",\"segments\":{},\"totalCycles\":{},\"userCycles\":{},\"seconds\":{:.1}}}",
                hex::encode(image_id.as_bytes()),
                hex::encode(&params.as_bytes()[..4]),
                info.stats.segments,
                info.stats.total_cycles,
                info.stats.user_cycles,
                seconds
            );
        }
        other => bail!("unknown mode {other}"),
    }
    Ok(())
}
