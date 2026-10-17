// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CertManager} from "../direct/CertManager.sol";
import {IP384Verifier} from "../direct/IP384Verifier.sol";

/// @notice Replays expired public fixture attestations on a live chain. Fixture runs only.
/// @dev Same pattern as base/nitro-validator's test/helpers/CertManagerDemo.sol: a certificate
///      past its end date is still accepted for `graceSeconds`. Everything else is the
///      ownerless CertManager unchanged, so the gas measured is the production path plus one
///      subtraction. Never the contract a real join uses.
contract CertManagerFixtureClock is CertManager {
    uint256 public immutable graceSeconds;

    constructor(IP384Verifier p384Verifier_, uint256 graceSeconds_) CertManager(p384Verifier_) {
        graceSeconds = graceSeconds_;
    }

    function _certificateExpired(uint256 notAfter) internal view override returns (bool) {
        if (notAfter >= block.timestamp) {
            return false;
        }
        return block.timestamp - notAfter > graceSeconds;
    }
}
