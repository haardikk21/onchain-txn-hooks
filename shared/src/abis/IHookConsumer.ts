export const IHookConsumerABI = [
  {
    type: "function",
    name: "trigger",
    inputs: [
      {
        name: "filter",
        type: "tuple",
        internalType: "struct EventFilter",
        components: [
          { name: "contractAddress", type: "address", internalType: "address" },
          { name: "topic0", type: "bytes32", internalType: "bytes32" },
          { name: "topic1", type: "bytes32", internalType: "bytes32" },
          { name: "topic2", type: "bytes32", internalType: "bytes32" },
          { name: "topic3", type: "bytes32", internalType: "bytes32" },
          { name: "useTopic1", type: "bool", internalType: "bool" },
          { name: "useTopic2", type: "bool", internalType: "bool" },
          { name: "useTopic3", type: "bool", internalType: "bool" }
        ]
      },
      {
        name: "eventLog",
        type: "tuple",
        internalType: "struct EventLog",
        components: [
          { name: "contractAddress", type: "address", internalType: "address" },
          { name: "topics", type: "bytes32[]", internalType: "bytes32[]" },
          { name: "data", type: "bytes", internalType: "bytes" },
          { name: "blockNumber", type: "uint256", internalType: "uint256" },
          { name: "blockTimestamp", type: "uint256", internalType: "uint256" },
          { name: "transactionHash", type: "bytes32", internalType: "bytes32" },
          { name: "logIndex", type: "uint256", internalType: "uint256" }
        ]
      },
      { name: "blockNumber", type: "uint256", internalType: "uint256" },
      { name: "blockTimestamp", type: "uint256", internalType: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  }
] as const;