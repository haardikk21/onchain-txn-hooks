// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

struct EventFilter {
    address contractAddress;
    bytes32 topic0;
    bytes32 topic1;
    bytes32 topic2;
    bytes32 topic3;
    bool useTopic1;
    bool useTopic2;
    bool useTopic3;
}

struct EventLog {
    address contractAddress;
    bytes32[] topics;
    bytes data;
    uint256 blockNumber;
    uint256 blockTimestamp;
    bytes32 transactionHash;
    uint256 logIndex;
}

interface IHookConsumer {
    /**
     * @notice Called when a monitored event is detected
     * @param filter The event filter that matched this event
     * @param eventLog The actual event log data
     * @param blockNumber Block number when the event was emitted
     * @param blockTimestamp Block timestamp when the event was emitted
     */
    function trigger(
        EventFilter memory filter,
        EventLog memory eventLog,
        uint256 blockNumber,
        uint256 blockTimestamp
    ) external;
}