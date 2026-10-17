// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Pcr, VerificationResult, VerifierJournal, ZkCoProcessorType} from "./zk/automata/INitroEnclaveVerifier.sol";

/// @dev The one function both Automata's NitroEnclaveVerifier and the ownerless port expose.
interface INitroJournalVerifier {
    function verify(bytes calldata output, ZkCoProcessorType zkCoprocessor, bytes calldata proofBytes)
        external
        returns (VerifierJournal memory journal);
}

/// @title NitroZkCanary
/// @notice The same join and score test as NitroCanary, with the attestation checked by a
///         zero-knowledge proof of Automata's guest program instead of by P-384 on chain.
/// @dev Nothing is settable after deployment. Differences from NitroCanary, both forced by
///      what the guest commits to its journal:
///      - the journal carries certificate hashes, not end dates, so the lease is the
///        attestation time plus 24 hours and cannot end with the leaf certificate;
///      - the image is read from the journal's PCR list by index.
contract NitroZkCanary {
    uint64 public constant MAX_LEASE = 24 hours;
    bytes32 public constant SCORE_DOMAIN = keccak256("ospex.nitro-canary.score.v1");
    bytes32 public constant DEBUG_IMAGE_HASH = keccak256(new bytes(144));

    INitroJournalVerifier public immutable verifier;
    bytes32 public immutable imageHash;

    struct Lease {
        uint64 end;
        uint64 docTimestampMs;
    }

    mapping(address => Lease) public leases;

    error DebugImage();
    error NotVerified(VerificationResult result);
    error WrongImage();
    error BadPublicKey();
    error LeaseOver();
    error StaleDocument();
    error NotJoined();
    error BadSignature();

    event Joined(address indexed signer, uint64 leaseEnd, uint64 docTimestampMs);
    event ScoreAccepted(address indexed signer, uint256 indexed contestId, uint32 awayScore, uint32 homeScore);

    constructor(INitroJournalVerifier verifier_, bytes32 imageHash_) {
        if (imageHash_ == DEBUG_IMAGE_HASH) revert DebugImage();
        verifier = verifier_;
        imageHash = imageHash_;
    }

    function join(bytes calldata output, bytes calldata proofBytes) external returns (address signer, uint64 leaseEnd) {
        VerifierJournal memory journal = verifier.verify(output, ZkCoProcessorType.RiscZero, proofBytes);
        if (journal.result != VerificationResult.Success) revert NotVerified(journal.result);

        if (_imageHashOf(journal.pcrs) != imageHash) revert WrongImage();

        bytes memory publicKey = journal.publicKey;
        if (publicKey.length != 65 || publicKey[0] != 0x04) revert BadPublicKey();
        bytes32 keyHash;
        assembly {
            keyHash := keccak256(add(publicKey, 0x21), 64)
        }
        signer = address(uint160(uint256(keyHash)));

        leaseEnd = journal.timestamp / 1000 + MAX_LEASE;
        if (leaseEnd <= block.timestamp) revert LeaseOver();

        Lease storage lease = leases[signer];
        if (journal.timestamp <= lease.docTimestampMs) revert StaleDocument();
        lease.end = leaseEnd;
        lease.docTimestampMs = journal.timestamp;

        emit Joined(signer, leaseEnd, journal.timestamp);
    }

    function acceptScore(uint256 contestId, uint32 awayScore, uint32 homeScore, bytes calldata signature)
        external
        returns (address signer)
    {
        signer = _recover(scoreDigest(contestId, awayScore, homeScore), signature);
        Lease memory lease = leases[signer];
        if (lease.end == 0) revert NotJoined();
        if (lease.end <= block.timestamp) revert LeaseOver();
        emit ScoreAccepted(signer, contestId, awayScore, homeScore);
    }

    function scoreDigest(uint256 contestId, uint32 awayScore, uint32 homeScore) public view returns (bytes32) {
        return keccak256(abi.encode(SCORE_DOMAIN, block.chainid, address(this), contestId, awayScore, homeScore));
    }

    function _imageHashOf(Pcr[] memory pcrs) internal pure returns (bytes32) {
        bytes memory packed = new bytes(144);
        uint256 found;
        for (uint256 i = 0; i < pcrs.length; ++i) {
            uint64 index = pcrs[i].index;
            if (index > 2) continue;
            if (found & (1 << index) != 0) revert WrongImage();
            found |= 1 << index;
            bytes32 first = pcrs[i].value.first;
            bytes16 second = pcrs[i].value.second;
            uint256 at = index * 48;
            assembly {
                mstore(add(add(packed, 0x20), at), first)
            }
            for (uint256 b = 0; b < 16; ++b) {
                packed[at + 32 + b] = second[b];
            }
        }
        if (found != 7) revert WrongImage();
        return keccak256(packed);
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address signer) {
        if (signature.length != 65) revert BadSignature();
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27;
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert BadSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
    }
}
