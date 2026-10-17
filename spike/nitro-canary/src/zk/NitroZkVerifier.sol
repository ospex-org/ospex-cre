// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {IRiscZeroVerifier} from "risc0/IRiscZeroVerifier.sol";
import {ZkCoProcessorType, VerifierJournal, VerificationResult} from "./automata/INitroEnclaveVerifier.sol";

/// @title NitroZkVerifier
/// @notice Ownerless port of automata-network/aws-nitro-enclave-attestation
///         contracts/src/NitroEnclaveVerifier.sol at commit
///         65c4a4233029ea3bbe16110a80731fcfd47cf300, single-attestation RISC Zero path only.
/// @dev Changes from the original, all of them removals or freezes:
///      - no owner: the root certificate, the guest program id, the RISC Zero verifier address
///        and the time window are fixed at deployment;
///      - no certificate revocation, no program-id rotation, no per-selector routes;
///      - no SP1 or Pico path and no batch path.
///      `verify` keeps the original signature, journal checks, certificate caching and event,
///      so the gas of a check is comparable with the original's.
///      Point `zkVerifier` at a RiscZeroGroth16Verifier directly, not at a router: the direct
///      verifier has no owner and cannot be paused or upgraded.
contract NitroZkVerifier {
    bytes32 public immutable rootCert;
    bytes32 public immutable verifierId;
    IRiscZeroVerifier public immutable zkVerifier;
    uint64 public immutable maxTimeDiff;

    /// @dev Intermediate certificate hashes proven once in a guest run; excludes the root.
    mapping(bytes32 trustedCertHash => bool) public trustedIntermediateCerts;

    error OnlyRiscZero();

    event AttestationSubmitted(VerificationResult result, ZkCoProcessorType zkCoProcessor, bytes output);

    constructor(bytes32 rootCert_, bytes32 verifierId_, IRiscZeroVerifier zkVerifier_, uint64 maxTimeDiff_) {
        rootCert = rootCert_;
        verifierId = verifierId_;
        zkVerifier = zkVerifier_;
        maxTimeDiff = maxTimeDiff_;
    }

    /// @notice Same as the original: how many leading certificates of each chain are trusted.
    function checkTrustedIntermediateCerts(bytes32[][] calldata _report_certs) public view returns (uint8[] memory) {
        uint8[] memory results = new uint8[](_report_certs.length);
        bytes32 rootCertHash = rootCert;
        for (uint256 i = 0; i < _report_certs.length; i++) {
            bytes32[] calldata certs = _report_certs[i];
            uint8 trustedCertPrefixLen = 1;
            if (certs[0] != rootCertHash) {
                revert("First certificate must be the root certificate");
            }
            for (uint256 j = 1; j < certs.length; j++) {
                if (!trustedIntermediateCerts[certs[j]]) {
                    break;
                }
                trustedCertPrefixLen += 1;
            }
            results[i] = trustedCertPrefixLen;
        }
        return results;
    }

    function verify(bytes calldata output, ZkCoProcessorType zkCoprocessor, bytes calldata proofBytes)
        external
        returns (VerifierJournal memory journal)
    {
        if (zkCoprocessor != ZkCoProcessorType.RiscZero) revert OnlyRiscZero();
        zkVerifier.verify(proofBytes, verifierId, sha256(output));
        journal = abi.decode(output, (VerifierJournal));
        journal = _verifyJournal(journal);
        emit AttestationSubmitted(journal.result, zkCoprocessor, output);
    }

    function _cacheNewCert(VerifierJournal memory journal) internal {
        for (uint256 i = journal.trustedCertsPrefixLen; i < journal.certs.length; i++) {
            bytes32 certHash = journal.certs[i];
            trustedIntermediateCerts[certHash] = true;
        }
    }

    function _verifyJournal(VerifierJournal memory journal) internal returns (VerifierJournal memory) {
        if (journal.result != VerificationResult.Success) {
            return journal;
        }
        if (journal.trustedCertsPrefixLen == 0) {
            journal.result = VerificationResult.RootCertNotTrusted;
            return journal;
        }
        for (uint256 i = 0; i < journal.trustedCertsPrefixLen; i++) {
            bytes32 certHash = journal.certs[i];
            if (i == 0) {
                if (certHash != rootCert) {
                    journal.result = VerificationResult.RootCertNotTrusted;
                    return journal;
                }
                continue;
            }
            if (!trustedIntermediateCerts[certHash]) {
                journal.result = VerificationResult.IntermediateCertsNotTrusted;
                return journal;
            }
        }
        uint64 timestamp = journal.timestamp / 1000;
        if (timestamp + maxTimeDiff < block.timestamp || timestamp > block.timestamp) {
            journal.result = VerificationResult.InvalidTimestamp;
            return journal;
        }
        _cacheNewCert(journal);
        return journal;
    }
}
