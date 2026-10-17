// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

// Builds RISC Zero's direct Groth16 verifier from risc0-ethereum v3.0.1 (the lib submodule),
// so it can be deployed on its own, with no router in front of it.
import {RiscZeroGroth16Verifier} from "risc0/groth16/RiscZeroGroth16Verifier.sol";
import {ControlID} from "risc0/groth16/ControlID.sol";

contract Risc0VerifierBuild {
    function controlRoot() external pure returns (bytes32, bytes32) {
        return (ControlID.CONTROL_ROOT, ControlID.BN254_CONTROL_ID);
    }
}
