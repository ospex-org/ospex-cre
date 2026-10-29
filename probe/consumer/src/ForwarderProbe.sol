// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev ERC-165, as the Chainlink forwarder checks it before it calls a receiver.
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @dev The receiver interface the Chainlink forwarder calls, as the CRE consumer-contract docs give it.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/**
 * @title ForwarderProbe
 * @notice A probe, not a reporter. It answers one question: what does a consumer on Polygon receive when a
 *         workflow writes to it through the production forwarder? Only the one forwarder fixed at deploy may
 *         call it, and it keeps every delivery it is handed, whole: the metadata bytes as the forwarder passed
 *         them, the report bytes, the sender, the block. It decides nothing, pays nothing and holds nothing.
 *
 *         The metadata is also read the way the games set's Chainlink reporter reads it, so the read-back is
 *         in the reporter's terms: the workflow id at bytes 0 to 32, the hash of the workflow's name at 32 to
 *         42, the workflow owner at 42 to 62 and the two-byte report id at 62 to 64. Shorter metadata is kept
 *         as it came and reads zero in the fields it does not reach, so a delivery that is not 64 bytes is
 *         still recorded rather than refused: the point of the probe is to see what arrives.
 *
 *         The forwarder is fixed by address alone. This contract is deployed before anything is known about
 *         the workflow that will write to it, so it checks no owner and no id: those are what it is here to
 *         read.
 */
contract ForwarderProbe is IReceiver {
    /// @notice One delivery, as it was handed over, plus the metadata's fields as the reporter reads them.
    struct Delivery {
        bytes metadata;
        bytes report;
        address sender;
        uint64 blockNumber;
        uint64 blockTime;
        bytes32 workflowId;
        bytes10 workflowName;
        address workflowOwner;
        bytes2 reportId;
    }

    /// @notice Thrown when the constructor's forwarder is the zero address
    error ForwarderProbe__NoForwarder();
    /// @notice Thrown when anything but the forwarder calls onReport
    error ForwarderProbe__NotTheForwarder(address sender);

    /// @notice Emitted for every delivery kept, with the metadata's fields as the reporter reads them.
    event Delivered(
        uint256 indexed index,
        bytes32 workflowId,
        bytes10 workflowName,
        address workflowOwner,
        bytes2 reportId,
        uint256 metadataLength,
        uint256 reportLength
    );

    /// @notice The only address that may call onReport
    address public immutable i_forwarder;

    Delivery[] private s_deliveries;

    /// @param forwarder The forwarder whose deliveries are kept. Not zero. Not checked for code: the probe is
    ///        deployed by address, and what calls it is what the record shows.
    constructor(address forwarder) {
        if (forwarder == address(0)) revert ForwarderProbe__NoForwarder();
        i_forwarder = forwarder;
    }

    /// @notice Keeps a delivery. Only the forwarder may call.
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != i_forwarder) revert ForwarderProbe__NotTheForwarder(msg.sender);
        Delivery memory d;
        d.metadata = metadata;
        d.report = report;
        d.sender = msg.sender;
        d.blockNumber = uint64(block.number);
        d.blockTime = uint64(block.timestamp);
        if (metadata.length >= 32) d.workflowId = bytes32(metadata[0:32]);
        if (metadata.length >= 42) d.workflowName = bytes10(metadata[32:42]);
        if (metadata.length >= 62) d.workflowOwner = address(bytes20(metadata[42:62]));
        if (metadata.length >= 64) d.reportId = bytes2(metadata[62:64]);
        s_deliveries.push(d);
        emit Delivered(
            s_deliveries.length - 1,
            d.workflowId,
            d.workflowName,
            d.workflowOwner,
            d.reportId,
            metadata.length,
            report.length
        );
    }

    /// @notice How many deliveries are kept
    function count() external view returns (uint256) {
        return s_deliveries.length;
    }

    /// @notice One delivery, whole
    function delivery(uint256 index) external view returns (Delivery memory) {
        return s_deliveries[index];
    }

    /// @notice One delivery's metadata, as handed over
    function metadataOf(uint256 index) external view returns (bytes memory) {
        return s_deliveries[index].metadata;
    }

    /// @notice One delivery's report, as handed over
    function reportOf(uint256 index) external view returns (bytes memory) {
        return s_deliveries[index].report;
    }

    /// @notice One delivery's metadata fields, as the reporter reads them, and the lengths of what was handed over
    function fields(uint256 index)
        external
        view
        returns (
            bytes32 workflowId,
            bytes10 workflowName,
            address workflowOwner,
            bytes2 reportId,
            uint256 metadataLength,
            uint256 reportLength
        )
    {
        Delivery storage d = s_deliveries[index];
        return (d.workflowId, d.workflowName, d.workflowOwner, d.reportId, d.metadata.length, d.report.length);
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
