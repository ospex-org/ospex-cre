// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

interface ICertManager {
    struct VerifiedCert {
        bool ca;
        uint64 notAfter;
        int64 maxPathLen;
        bytes32 subjectHash;
        bytes pubKey;
    }

    // --- Active (hinted) entrypoints ---

    /// @notice Verify a CA certificate against its already-cached parent and cache the result.
    /// @dev Idempotent with a cache short-circuit: if `cert` is already verified and unexpired, the
    ///      cached record is returned and `signatureHints` is ignored, but `parentCertHash` must
    ///      match the parent used during cold verification. On a cold cert, `signatureHints` must
    ///      contain the real off-chain inverse hints for the cert signature; they are re-verified
    ///      on-chain, so a wrong hint only reverts. Pass zero only when submitting the pinned root.
    /// @param cert DER-encoded CA certificate to verify and cache.
    /// @param parentCertHash Cache key of the CA that signed `cert`, or zero for the pinned root.
    /// @param signatureHints Packed inverse hints for cold certificate signature verification.
    /// @return certHash Cache key for `cert`: ROOT_CA_CERT_HASH for the pinned root, otherwise
    ///         keccak256(tbsCertificate). Suitable as a parent key for child certificates.
    function verifyCACertWithHints(bytes memory cert, bytes32 parentCertHash, bytes memory signatureHints)
        external
        returns (bytes32 certHash);

    /// @notice Verify a leaf certificate against its already-cached parent and cache the result.
    /// @dev Uses the same cold-verification and cache-short-circuit semantics as
    ///      {verifyCACertWithHints}.
    /// @param cert DER-encoded leaf certificate to verify and cache.
    /// @param parentCertHash Cache key of the CA that signed `cert`.
    /// @param signatureHints Packed inverse hints for cold certificate signature verification.
    /// @return verifiedCert Verified leaf certificate metadata.
    function verifyClientCertWithHints(bytes memory cert, bytes32 parentCertHash, bytes memory signatureHints)
        external
        returns (VerifiedCert memory verifiedCert);

    /// @notice Raw cache read by verification cache key. A returned cert may be expired.
    /// @param certHash Certificate cache key.
    /// @return cert Raw cached metadata, which may no longer be trusted.
    function loadVerified(bytes32 certHash) external view returns (VerifiedCert memory cert);

    // --- DEPRECATED: these always revert; use the *WithHints variants above. ---

    /// @notice DEPRECATED: always reverts. Use {verifyCACertWithHints}.
    /// @dev Retained as an ABI-compatibility stub. The fully on-chain P-384 verification path
    ///      became too expensive after Fusaka's EIP-7883 MODEXP repricing and has been removed.
    /// @param cert Unused legacy certificate argument.
    /// @param parentCertHash Unused legacy parent cache key argument.
    /// @return certHash Unreachable legacy return value.
    function verifyCACert(bytes memory cert, bytes32 parentCertHash) external returns (bytes32 certHash);

    /// @notice DEPRECATED: always reverts. Use {verifyClientCertWithHints}.
    /// @dev Retained as an ABI-compatibility stub. The fully on-chain P-384 verification path
    ///      became too expensive after Fusaka's EIP-7883 MODEXP repricing and has been removed.
    /// @param cert Unused legacy certificate argument.
    /// @param parentCertHash Unused legacy parent cache key argument.
    /// @return verifiedCert Unreachable legacy return value.
    function verifyClientCert(bytes memory cert, bytes32 parentCertHash)
        external
        returns (VerifiedCert memory verifiedCert);
}
