// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CertManager} from "../src/direct/CertManager.sol";
import {ICertManager} from "../src/direct/ICertManager.sol";
import {NitroValidator} from "../src/direct/NitroValidator.sol";
import {P384Verifier} from "../src/direct/P384Verifier.sol";
import {NitroCanary} from "../src/NitroCanary.sol";

/// @dev Test-only: sets a lease directly so the score path can be tested without an enclave key.
contract NitroCanaryHarness is NitroCanary {
    constructor(NitroValidator v, bytes32 image) NitroCanary(v, image) {}

    function setLeaseForTest(address signer, uint64 end) external {
        leases[signer] = Lease({end: end, docTimestampMs: 1});
    }
}

/// Replays the public fixture attestations (fixtures/, plans from tools/plan.mjs) through the
/// ownerless checker and the canary, at each fixture's own time.
contract NitroCanaryTest is Test {
    struct CertCall {
        bytes cert;
        bytes32 parentCertHash;
        bytes hints;
    }

    P384Verifier p384;
    CertManager certManager;
    NitroValidator validator;

    bytes32 constant BASE_IMAGE = 0x2f61a13c22b41f192f95674c2ccd968b0181f96947d9632a9812923897532bcf;

    function setUp() public {
        p384 = new P384Verifier();
        certManager = new CertManager(p384);
        validator = new NitroValidator(certManager, p384);
    }

    function _plan(string memory name) internal view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), "/fixtures/plans/", name, ".json"));
    }

    function _cacheChain(string memory json) internal {
        uint256 n = 3;
        for (uint256 i = 0; i < n; ++i) {
            string memory k = string.concat(".caCerts[", vm.toString(i), "]");
            certManager.verifyCACertWithHints(
                vm.parseJsonBytes(json, string.concat(k, ".cert")),
                vm.parseJsonBytes32(json, string.concat(k, ".parentCertHash")),
                vm.parseJsonBytes(json, string.concat(k, ".hints"))
            );
        }
        certManager.verifyClientCertWithHints(
            vm.parseJsonBytes(json, ".leaf.cert"),
            vm.parseJsonBytes32(json, ".leaf.parentCertHash"),
            vm.parseJsonBytes(json, ".leaf.hints")
        );
    }

    function _doc(string memory json) internal pure returns (bytes memory tbs, bytes memory sig, bytes memory hints) {
        tbs = vm.parseJsonBytes(json, ".attestationTbs");
        sig = vm.parseJsonBytes(json, ".signature");
        hints = vm.parseJsonBytes(json, ".attestationHints");
    }

    function _at(string memory json) internal {
        vm.warp(vm.parseJsonUint(json, ".timestampSeconds") + 60);
    }

    // --- the image gate, with real Amazon documents -------------------------------------------

    /// Base's fixture is a production image whose `public_key` is empty. A canary pinned to its
    /// image gets past the image check and refuses at the key: this is the acceptance half.
    function test_approvedImagePassesImageGate_thenNeedsKey() public {
        string memory json = _plan("base-2026-01-03");
        assertEq(vm.parseJsonBytes32(json, ".imageHash"), BASE_IMAGE);
        _at(json);
        _cacheChain(json);
        NitroCanary canary = new NitroCanary(validator, BASE_IMAGE);
        (bytes memory tbs, bytes memory sig, bytes memory hints) = _doc(json);
        vm.expectRevert(NitroCanary.BadPublicKey.selector);
        canary.join(tbs, sig, hints);
    }

    /// The same canary refuses a genuine document from another production image.
    function test_otherImageRefused() public {
        string memory json = _plan("automata-2023-09-28");
        _at(json);
        _cacheChain(json);
        NitroCanary canary = new NitroCanary(validator, BASE_IMAGE);
        (bytes memory tbs, bytes memory sig, bytes memory hints) = _doc(json);
        vm.expectRevert(NitroCanary.WrongImage.selector);
        canary.join(tbs, sig, hints);
    }

    /// A genuine debug-mode document (all-zero PCRs) is refused, and no canary can pin it.
    function test_debugImageRefused() public {
        string memory json = _plan("automata-2024-08-16");
        bytes32 zeros = vm.parseJsonBytes32(json, ".imageHash");
        _at(json);
        _cacheChain(json);
        NitroCanary canary = new NitroCanary(validator, BASE_IMAGE);
        (bytes memory tbs, bytes memory sig, bytes memory hints) = _doc(json);
        vm.expectRevert(NitroCanary.WrongImage.selector);
        canary.join(tbs, sig, hints);

        assertEq(zeros, canary.DEBUG_IMAGE_HASH());
        vm.expectRevert(NitroCanary.DebugImage.selector);
        new NitroCanary(validator, zeros);
    }

    /// One changed byte in the signed document is refused by the checker.
    function test_tamperedDocumentRefused() public {
        string memory json = _plan("base-2026-01-03");
        _at(json);
        _cacheChain(json);
        (bytes memory tbs, bytes memory sig, bytes memory hints) = _doc(json);
        tbs[tbs.length - 40] = bytes1(uint8(tbs[tbs.length - 40]) ^ 1);
        vm.expectRevert();
        validator.validateAttestationWithHints(tbs, sig, hints);
    }

    /// After the leaf certificate's end the cached chain is refused (no grace in production).
    function test_expiredLeafRefused() public {
        string memory json = _plan("base-2026-01-03");
        _at(json);
        _cacheChain(json);
        (bytes memory tbs, bytes memory sig, bytes memory hints) = _doc(json);
        validator.validateAttestationWithHints(tbs, sig, hints);
        vm.warp(vm.parseJsonUint(json, ".timestampSeconds") + 3 hours);
        vm.expectRevert();
        validator.validateAttestationWithHints(tbs, sig, hints);
    }

    // --- the score path ---------------------------------------------------------------------

    function test_scoreFromJoinedKeyAccepted_othersRefused() public {
        NitroCanaryHarness canary = new NitroCanaryHarness(validator, BASE_IMAGE);
        (address enclave, uint256 enclaveKey) = makeAddrAndKey("enclave");
        (, uint256 strangerKey) = makeAddrAndKey("stranger");
        canary.setLeaseForTest(enclave, uint64(block.timestamp + 1 hours));

        bytes32 digest = canary.scoreDigest(1, 30, 23);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(enclaveKey, digest);
        assertEq(canary.acceptScore(1, 30, 23, abi.encodePacked(r, s, v)), enclave);

        // A different score under the same signature recovers someone who never joined.
        vm.expectRevert(NitroCanary.NotJoined.selector);
        canary.acceptScore(1, 23, 30, abi.encodePacked(r, s, v));

        // A key that never joined.
        (v, r, s) = vm.sign(strangerKey, digest);
        vm.expectRevert(NitroCanary.NotJoined.selector);
        canary.acceptScore(1, 30, 23, abi.encodePacked(r, s, v));

        // The joined key after its lease.
        (v, r, s) = vm.sign(enclaveKey, digest);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(NitroCanary.LeaseOver.selector);
        canary.acceptScore(1, 30, 23, abi.encodePacked(r, s, v));
    }
}
