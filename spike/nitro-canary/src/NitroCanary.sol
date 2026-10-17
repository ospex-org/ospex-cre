// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Asn1Decode, Asn1Ptr, LibAsn1Ptr} from "./direct/Asn1Decode.sol";
import {CborDecode, CborElement, LibCborElement} from "./direct/CborDecode.sol";
import {ICertManager} from "./direct/ICertManager.sol";
import {LibBytes} from "./direct/LibBytes.sol";
import {NitroValidator} from "./direct/NitroValidator.sol";

/// @title NitroCanary
/// @notice Test contract for one question: does a Polygon contract with no owner accept a score
///         signed by an enclave whose AWS Nitro attestation it checked itself, and refuse one
///         from any other enclave image?
/// @dev Nothing is settable after deployment. The approved image is fixed at deployment as
///      keccak256(PCR0 || PCR1 || PCR2). The attestation is checked by the ownerless port of
///      Base's hinted checker (see `direct/`). A join stores the secp256k1 key the enclave put in
///      the attestation's `public_key` field, with a lease that ends at the earlier of the
///      attestation time plus 24 hours and the earliest certificate end in its chain.
///      Not in scope here: the nonce and user-data freshness binding, and any scoring rule.
contract NitroCanary {
    using Asn1Decode for bytes;
    using CborDecode for bytes;
    using LibAsn1Ptr for Asn1Ptr;
    using LibBytes for bytes;
    using LibCborElement for CborElement;

    uint64 public constant MAX_LEASE = 24 hours;
    bytes32 public constant SCORE_DOMAIN = keccak256("ospex.nitro-canary.score.v1");
    /// @dev keccak256 of 144 zero bytes: the measurement every debug-mode enclave reports.
    bytes32 public constant DEBUG_IMAGE_HASH = keccak256(new bytes(144));

    NitroValidator public immutable validator;
    ICertManager public immutable certManager;
    bytes32 public immutable imageHash;

    struct Lease {
        uint64 end;
        uint64 docTimestampMs;
    }

    mapping(address => Lease) public leases;

    error DebugImage();
    error WrongImage();
    error BadPublicKey();
    error LeaseOver();
    error StaleDocument();
    error NotJoined();
    error BadSignature();

    event Joined(address indexed signer, uint64 leaseEnd, uint64 docTimestampMs, uint64 earliestCertEnd);
    event ScoreAccepted(address indexed signer, uint256 indexed contestId, uint32 awayScore, uint32 homeScore);

    constructor(NitroValidator validator_, bytes32 imageHash_) {
        if (imageHash_ == DEBUG_IMAGE_HASH) revert DebugImage();
        validator = validator_;
        certManager = validator_.certManager();
        imageHash = imageHash_;
    }

    /// @notice Check an attestation and store the enclave key it carries.
    /// @dev The certificate chain must already be cached in the cert manager (the earlier
    ///      transactions of a cold or new-leaf join). Checks run in this order: signature and
    ///      chain (validator), image, key, lease, document time.
    function join(bytes memory attestationTbs, bytes memory signature, bytes memory hints)
        external
        returns (address signer, uint64 leaseEnd)
    {
        NitroValidator.Ptrs memory ptrs = validator.validateAttestationWithHints(attestationTbs, signature, hints);

        if (_imageHashOf(attestationTbs, ptrs) != imageHash) revert WrongImage();

        if (CborElement.unwrap(ptrs.publicKey) == 0 || ptrs.publicKey.isNull()) revert BadPublicKey();
        bytes memory publicKey = attestationTbs.slice(ptrs.publicKey);
        if (publicKey.length != 65 || publicKey[0] != 0x04) revert BadPublicKey();
        signer = address(uint160(uint256(publicKey.keccak(1, 64))));

        uint64 earliestCertEnd = _earliestCertEnd(attestationTbs, ptrs);
        uint64 docSeconds = ptrs.timestamp / 1000;
        leaseEnd = docSeconds + MAX_LEASE < earliestCertEnd ? docSeconds + MAX_LEASE : earliestCertEnd;
        if (leaseEnd <= block.timestamp) revert LeaseOver();

        Lease storage lease = leases[signer];
        if (ptrs.timestamp <= lease.docTimestampMs) revert StaleDocument();
        lease.end = leaseEnd;
        lease.docTimestampMs = ptrs.timestamp;

        emit Joined(signer, leaseEnd, ptrs.timestamp, earliestCertEnd);
    }

    /// @notice Accept a score signed by a joined enclave key whose lease has not ended.
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

    /// @notice The digest an enclave signs for a score: bound to this chain and this contract.
    function scoreDigest(uint256 contestId, uint32 awayScore, uint32 homeScore) public view returns (bytes32) {
        return keccak256(abi.encode(SCORE_DOMAIN, block.chainid, address(this), contestId, awayScore, homeScore));
    }

    function _imageHashOf(bytes memory attestationTbs, NitroValidator.Ptrs memory ptrs)
        internal
        pure
        returns (bytes32)
    {
        for (uint256 i = 0; i < 3; ++i) {
            if (ptrs.pcrs[i].isNull() || ptrs.pcrs[i].length() != 48) revert WrongImage();
        }
        return keccak256(
            abi.encodePacked(
                attestationTbs.slice(ptrs.pcrs[0]), attestationTbs.slice(ptrs.pcrs[1]), attestationTbs.slice(ptrs.pcrs[2])
            )
        );
    }

    /// @dev Reads each certificate's end date from the cert manager's cache, which the
    ///      validator call above has just re-checked. The pinned root (index 0) is skipped.
    function _earliestCertEnd(bytes memory attestationTbs, NitroValidator.Ptrs memory ptrs)
        internal
        view
        returns (uint64 earliest)
    {
        earliest = type(uint64).max;
        for (uint256 i = 1; i < ptrs.cabundle.length; ++i) {
            uint64 end = certManager.loadVerified(_certCacheKey(attestationTbs.slice(ptrs.cabundle[i]))).notAfter;
            if (end < earliest) earliest = end;
        }
        uint64 leafEnd = certManager.loadVerified(_certCacheKey(attestationTbs.slice(ptrs.cert))).notAfter;
        if (leafEnd < earliest) earliest = leafEnd;
    }

    /// @dev Same key as the cert manager: keccak256 of the DER tbsCertificate.
    function _certCacheKey(bytes memory certificate) internal pure returns (bytes32) {
        Asn1Ptr tbsCertPtr = certificate.firstChildOf(certificate.root());
        return certificate.keccak(tbsCertPtr.header(), tbsCertPtr.totalLength());
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address signer) {
        if (signature.length != 65) revert BadSignature();
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27;
        // Reject the high-s twin so one signature has one form.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert BadSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
    }
}
