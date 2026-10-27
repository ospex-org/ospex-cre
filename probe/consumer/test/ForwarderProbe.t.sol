// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ForwarderProbe, IERC165, IReceiver} from "../src/ForwarderProbe.sol";

/// @dev The cheatcodes these tests use, declared here so the probe needs no library.
interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes calldata revertData) external;
    function roll(uint256 blockNumber) external;
    function warp(uint256 timestamp) external;
    function envOr(string calldata name, string calldata defaultValue) external view returns (string memory);
    function createSelectFork(string calldata urlOrAlias) external returns (uint256);
}

/// @dev A stand-in for the forwarder as the probe sees it: it checks ERC-165 for IReceiver with bounded static
///      calls, calls onReport with what it is handed, and bubbles the receiver's revert. The production forwarder
///      does not bubble it (it records a failed delivery and emits ReportProcessed with result false); the
///      stand-in bubbles it so a test sees the probe's own reason.
contract MockForwarder {
    string public constant typeAndVersion = "KeystoneForwarder 1.0.0";

    error NotAReceiver(address receiver);

    function report(address receiver, bytes calldata metadata, bytes calldata data) external {
        if (
            !_supports(receiver, type(IERC165).interfaceId) || _supports(receiver, 0xffffffff)
                || !_supports(receiver, type(IReceiver).interfaceId)
        ) revert NotAReceiver(receiver);
        (bool ok, bytes memory err) = receiver.call(abi.encodeCall(IReceiver.onReport, (metadata, data)));
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(err, 0x20), mload(err))
            }
        }
    }

    function _supports(address receiver, bytes4 interfaceId) private view returns (bool) {
        (bool ok, bytes memory answer) =
            receiver.staticcall{gas: 30_000}(abi.encodeCall(IERC165.supportsInterface, (interfaceId)));
        return ok && answer.length >= 32 && abi.decode(answer, (bool));
    }
}

contract ForwarderProbeTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @dev The production forwarder on Polygon, the address the probe is deployed with.
    address private constant FORWARDER = 0x76c9cf548b4179F8901cda1f8623568b58215E62;

    // The metadata of a live v2 report, read from the forwarder's calldata on Polygon (block 89,368,231):
    // the id, the name hash (ASCII "830f5085b7"), the owner, report id 0x0002. 64 bytes.
    bytes32 private constant ID = 0x0097efdade80ff0a9557d927a1c07075a453bba9cd0fae7e22519c613ec47805;
    bytes10 private constant NAME = 0x38333066353038356237;
    address private constant OWNER = 0x40047BAFcdEd16C938058b7b67186299a2893561;
    bytes2 private constant REPORT_ID = 0x0002;

    ForwarderProbe private probe;
    bytes private metadata;
    bytes private report;

    function setUp() external {
        probe = new ForwarderProbe(FORWARDER);
        metadata = abi.encodePacked(ID, NAME, OWNER, REPORT_ID);
        report = abi.encode(uint64(1_761_540_000), "osprobe");
        require(metadata.length == 64, "the fixture is not a live report's 64 bytes");
    }

    function test_onlyTheForwarderIsHeard() external {
        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSelector(ForwarderProbe.ForwarderProbe__NotTheForwarder.selector, address(0xBEEF)));
        probe.onReport(metadata, report);
        require(probe.count() == 0, "a stranger's delivery was kept");

        vm.prank(FORWARDER);
        probe.onReport(metadata, report);
        require(probe.count() == 1, "the forwarder's delivery was not kept");
    }

    function test_keepsTheDeliveryWholeAndReadsItAsTheReporterDoes() external {
        vm.roll(96_300_000);
        vm.warp(1_761_540_123);
        vm.prank(FORWARDER);
        probe.onReport(metadata, report);

        ForwarderProbe.Delivery memory d = probe.delivery(0);
        require(keccak256(d.metadata) == keccak256(metadata), "the metadata is not as handed");
        require(keccak256(d.report) == keccak256(report), "the report is not as handed");
        require(d.sender == FORWARDER, "the sender is not the forwarder");
        require(d.blockNumber == 96_300_000, "the block number");
        require(d.blockTime == 1_761_540_123, "the block time");
        require(d.workflowId == ID, "the id is not bytes 0 to 32");
        require(d.workflowName == NAME, "the name is not bytes 32 to 42");
        require(d.workflowOwner == OWNER, "the owner is not bytes 42 to 62");
        require(d.reportId == REPORT_ID, "the report id is not bytes 62 to 64");

        (bytes32 id, bytes10 name, address owner, bytes2 reportId, uint256 mlen, uint256 rlen) = probe.fields(0);
        require(id == ID && name == NAME && owner == OWNER && reportId == REPORT_ID, "fields() differs from the delivery");
        require(mlen == 64 && rlen == report.length, "the lengths");
        require(keccak256(probe.metadataOf(0)) == keccak256(metadata), "metadataOf()");
        require(keccak256(probe.reportOf(0)) == keccak256(report), "reportOf()");
    }

    function test_everyDeliveryIsKeptInOrder() external {
        bytes memory second = abi.encodePacked(bytes32(uint256(7)), NAME, address(0xCAFE), bytes2(0x0003));
        vm.prank(FORWARDER);
        probe.onReport(metadata, report);
        vm.prank(FORWARDER);
        probe.onReport(second, hex"aa");
        require(probe.count() == 2, "two deliveries");
        require(probe.delivery(0).workflowId == ID, "the first is first");
        require(probe.delivery(1).workflowId == bytes32(uint256(7)), "the second is second");
        require(probe.delivery(1).workflowOwner == address(0xCAFE), "the second's owner");
        require(probe.delivery(1).reportId == bytes2(0x0003), "the second's report id");
        require(probe.delivery(1).report.length == 1, "the second's report");
    }

    function test_shortMetadataIsKeptAndReadsZeroWhereItDoesNotReach() external {
        bytes memory short62 = abi.encodePacked(ID, NAME, OWNER);
        vm.prank(FORWARDER);
        probe.onReport(short62, report);
        (bytes32 id, bytes10 name, address owner, bytes2 reportId, uint256 mlen,) = probe.fields(0);
        require(id == ID && name == NAME && owner == OWNER, "62 bytes read the three fields");
        require(reportId == bytes2(0) && mlen == 62, "no report id in 62 bytes");

        vm.prank(FORWARDER);
        probe.onReport(hex"0102", report);
        (id, name, owner, reportId, mlen,) = probe.fields(1);
        require(id == bytes32(0) && name == bytes10(0) && owner == address(0) && reportId == bytes2(0), "2 bytes read nothing");
        require(mlen == 2 && probe.delivery(1).metadata.length == 2, "the 2 bytes are kept");

        vm.prank(FORWARDER);
        probe.onReport("", report);
        require(probe.count() == 3 && probe.delivery(2).metadata.length == 0, "empty metadata is kept");
    }

    function test_longerMetadataReadsTheSameAndKeepsItsTail() external {
        bytes memory longer = abi.encodePacked(metadata, hex"deadbeef");
        vm.prank(FORWARDER);
        probe.onReport(longer, report);
        (bytes32 id, bytes10 name, address owner, bytes2 reportId, uint256 mlen,) = probe.fields(0);
        require(id == ID && name == NAME && owner == OWNER && reportId == REPORT_ID, "the first 64 bytes read the same");
        require(mlen == 68, "the tail is kept");
    }

    function test_answersForIReceiverAndIERC165Only() external view {
        require(probe.supportsInterface(type(IReceiver).interfaceId), "IReceiver");
        require(probe.supportsInterface(type(IERC165).interfaceId), "IERC165");
        require(!probe.supportsInterface(0xffffffff), "0xffffffff");
        require(!probe.supportsInterface(0x12345678), "another id");
    }

    function test_theForwarderRouteDeliversAndBubblesARefusal() external {
        MockForwarder fwd = new MockForwarder();
        ForwarderProbe viaMock = new ForwarderProbe(address(fwd));
        fwd.report(address(viaMock), metadata, report);
        require(viaMock.count() == 1, "routed");
        require(viaMock.delivery(0).sender == address(fwd), "the sender is the forwarder");

        // The same route to the probe fixed on another forwarder is refused by the probe's own reason.
        vm.expectRevert(abi.encodeWithSelector(ForwarderProbe.ForwarderProbe__NotTheForwarder.selector, address(fwd)));
        fwd.report(address(probe), metadata, report);
    }

    function test_theConstructorRefusesTheZeroAddress() external {
        vm.expectRevert(abi.encodeWithSelector(ForwarderProbe.ForwarderProbe__NoForwarder.selector));
        new ForwarderProbe(address(0));
    }

    /// @dev On a Polygon fork (POLYGON_RPC_URL set), the fixed address is the live forwarder, "KeystoneForwarder
    ///      1.0.0", and a call from it is kept. Returns without checking anything when the variable is unset.
    function test_theFixedAddressIsTheLiveForwarder() external {
        string memory url = vm.envOr("POLYGON_RPC_URL", "");
        if (bytes(url).length == 0) return;
        vm.createSelectFork(url);
        (bool ok, bytes memory answer) = FORWARDER.staticcall(abi.encodeWithSignature("typeAndVersion()"));
        require(ok, "typeAndVersion()");
        require(keccak256(bytes(abi.decode(answer, (string)))) == keccak256("KeystoneForwarder 1.0.0"), "not the forwarder");
        ForwarderProbe onFork = new ForwarderProbe(FORWARDER);
        vm.prank(FORWARDER);
        onFork.onReport(metadata, report);
        require(onFork.count() == 1, "the live forwarder's address delivers on the fork");
    }
}
