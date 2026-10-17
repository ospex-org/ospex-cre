// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Asn1Decode, Asn1Ptr, LibAsn1Ptr} from "../src/direct/Asn1Decode.sol";
import {LibBytes} from "../src/direct/LibBytes.sol";
import {CertManager} from "../src/direct/CertManager.sol";
import {NitroValidator} from "../src/direct/NitroValidator.sol";
import {P384Verifier} from "../src/direct/P384Verifier.sol";
import {CertManagerFixtureClock} from "../src/fixture/CertManagerFixtureClock.sol";
import {NitroCanary} from "../src/NitroCanary.sol";

/// Real transactions for the direct route, on Amoy. Sign with --keystore/--password-file.
///
///   deploy:      forge script script/Direct.s.sol --sig "deploy(bool,uint256,bytes32)" <fixtureClock> <grace> <image>
///   cache:       forge script ... --sig "cache(string,address)" <plan.json> <certManager>
///   join:        forge script ... --sig "join(string,address)" <plan.json> <canary>
///   validate:    forge script ... --sig "validate(string,address)" <plan.json> <validator>
///   score:       forge script ... --sig "score(address,uint256,uint32,uint32,bytes)" <canary> <contest> <away> <home> <sig>
///
/// Each call in the broadcast block is one transaction; receipts land in broadcast/.
/// Plans come from tools/plan.mjs.
contract Direct is Script {
    using Asn1Decode for bytes;
    using LibAsn1Ptr for Asn1Ptr;
    using LibBytes for bytes;

    function deploy(bool fixtureClock, uint256 grace, bytes32 image) external {
        vm.startBroadcast();
        P384Verifier p384 = new P384Verifier();
        CertManager certManager =
            fixtureClock ? CertManager(new CertManagerFixtureClock(p384, grace)) : new CertManager(p384);
        NitroValidator validator = new NitroValidator(certManager, p384);
        NitroCanary canary = new NitroCanary(validator, image);
        vm.stopBroadcast();
        console2.log("P384Verifier", address(p384));
        console2.log("CertManager", address(certManager));
        console2.log("NitroValidator", address(validator));
        console2.log("NitroCanary", address(canary));
    }

    /// Caches the non-root CAs and the leaf: one transaction per certificate.
    /// A certificate already cached is skipped, so a new leaf under a cached chain is one transaction.
    function cache(string calldata planPath, address certManager) external {
        string memory json = vm.readFile(planPath);
        CertManager cm = CertManager(certManager);
        vm.startBroadcast();
        for (uint256 i = 0; i < 3; ++i) {
            string memory k = string.concat(".caCerts[", vm.toString(i), "]");
            bytes memory cert = vm.parseJsonBytes(json, string.concat(k, ".cert"));
            if (_cached(cm, cert)) continue;
            cm.verifyCACertWithHints(
                cert,
                vm.parseJsonBytes32(json, string.concat(k, ".parentCertHash")),
                vm.parseJsonBytes(json, string.concat(k, ".hints"))
            );
        }
        bytes memory leaf = vm.parseJsonBytes(json, ".leaf.cert");
        if (!_cached(cm, leaf)) {
            cm.verifyClientCertWithHints(
                leaf, vm.parseJsonBytes32(json, ".leaf.parentCertHash"), vm.parseJsonBytes(json, ".leaf.hints")
            );
        }
        vm.stopBroadcast();
    }

    function join(string calldata planPath, address canary) external {
        string memory json = vm.readFile(planPath);
        vm.startBroadcast();
        (address signer, uint64 leaseEnd) = NitroCanary(canary).join(
            vm.parseJsonBytes(json, ".attestationTbs"),
            vm.parseJsonBytes(json, ".signature"),
            vm.parseJsonBytes(json, ".attestationHints")
        );
        vm.stopBroadcast();
        console2.log("joined", signer, leaseEnd);
    }

    function validate(string calldata planPath, address validator) external {
        string memory json = vm.readFile(planPath);
        vm.startBroadcast();
        NitroValidator(validator).validateAttestationWithHints(
            vm.parseJsonBytes(json, ".attestationTbs"),
            vm.parseJsonBytes(json, ".signature"),
            vm.parseJsonBytes(json, ".attestationHints")
        );
        vm.stopBroadcast();
    }

    function score(address canary, uint256 contestId, uint32 away, uint32 home, bytes calldata sig) external {
        vm.startBroadcast();
        address signer = NitroCanary(canary).acceptScore(contestId, away, home, sig);
        vm.stopBroadcast();
        console2.log("score accepted from", signer);
    }

    function _cached(CertManager cm, bytes memory cert) internal view returns (bool) {
        // Same cache key as the cert manager: keccak256 of the DER tbsCertificate.
        Asn1Ptr tbs = cert.firstChildOf(cert.root());
        return cm.loadVerified(cert.keccak(tbs.header(), tbs.totalLength())).pubKey.length != 0;
    }
}
