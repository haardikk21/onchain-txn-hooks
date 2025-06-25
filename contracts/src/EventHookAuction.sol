// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/console.sol";

contract EventHookAuction {
    // Custom errors
    error InvalidContractAddress();
    error InvalidTopic0();
    error BidTooLow(uint256 required, uint256 provided);
    error ZeroBid();
    error OnlyOwner();
    error AuctionNotActive();

    struct EventFilter {
        address contractAddress;
        bytes32 topic0; // Event signature hash
        bytes32 topic1; // Optional indexed parameter 1
        bytes32 topic2; // Optional indexed parameter 2
        bytes32 topic3; // Optional indexed parameter 3
        bool useTopic1;
        bool useTopic2;
        bool useTopic3;
    }

    struct Auction {
        address currentBidder;
        uint256 currentBid;
        uint256 minimumBid;
        uint256 lastBidTime;
        bool isActive;
        EventFilter filter;
    }

    // Map event filter hash to auction
    mapping(bytes32 => Auction) public auctions;

    // Protocol owner
    address public owner;

    // Minimum bid increment (1% increase required)
    uint256 public constant MIN_BID_INCREMENT = 101; // 101/100 = 1.01x
    uint256 public constant PERCENTAGE_BASE = 100;

    // Events
    event AuctionCreated(bytes32 indexed filterHash, EventFilter filter, uint256 minimumBid);
    event BidPlaced(bytes32 indexed filterHash, address indexed bidder, uint256 amount);
    event AuctionWon(bytes32 indexed filterHash, address indexed winner, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @dev Create a hash for an event filter to use as unique identifier
     */
    function getFilterHash(EventFilter memory filter) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                filter.contractAddress,
                filter.topic0,
                filter.topic1,
                filter.topic2,
                filter.topic3,
                filter.useTopic1,
                filter.useTopic2,
                filter.useTopic3
            )
        );
    }

    /**
     * @dev Place a bid on an event filter auction
     * First bid for a filter automatically creates the auction
     */
    function placeBid(EventFilter memory filter) external payable {
        if (filter.contractAddress == address(0)) revert InvalidContractAddress();
        if (filter.topic0 == bytes32(0)) revert InvalidTopic0();
        if (msg.value == 0) revert ZeroBid();

        bytes32 filterHash = getFilterHash(filter);
        Auction storage auction = auctions[filterHash];

        // If this is the first bid, initialize the auction
        if (auction.currentBidder == address(0) && auction.currentBid == 0) {
            auction.filter = filter;
            auction.isActive = true;
            auction.minimumBid = msg.value; // First bid sets minimum
            emit AuctionCreated(filterHash, filter, msg.value);
        } else {
            // Subsequent bids must meet increment requirement
            uint256 requiredBid = (auction.currentBid * MIN_BID_INCREMENT) / PERCENTAGE_BASE;
            if (msg.value < requiredBid) revert BidTooLow(requiredBid, msg.value);

            // Refund previous bidder
            payable(auction.currentBidder).transfer(auction.currentBid);
        }

        auction.currentBidder = msg.sender;
        auction.currentBid = msg.value;
        auction.lastBidTime = block.timestamp;

        emit BidPlaced(filterHash, msg.sender, msg.value);
    }

    /**
     * @dev Get current auction state for a filter
     */
    function getAuction(bytes32 filterHash)
        external
        view
        returns (
            address currentBidder,
            uint256 currentBid,
            uint256 minimumBid,
            uint256 lastBidTime,
            bool isActive,
            EventFilter memory filter
        )
    {
        Auction storage auction = auctions[filterHash];
        return (
            auction.currentBidder,
            auction.currentBid,
            auction.minimumBid,
            auction.lastBidTime,
            auction.isActive,
            auction.filter
        );
    }

    /**
     * @dev Get the winning bidder for a filter (if any)
     */
    function getWinner(bytes32 filterHash) external view returns (address) {
        return auctions[filterHash].currentBidder;
    }

    /**
     * @dev Pause/unpause an auction (emergency only)
     */
    function setAuctionActive(bytes32 filterHash, bool active) external onlyOwner {
        auctions[filterHash].isActive = active;
    }

    /**
     * @dev Owner can withdraw protocol fees
     */
    function withdraw() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    /**
     * @dev Emergency function to refund a bidder
     */
    function emergencyRefund(bytes32 filterHash) external onlyOwner {
        Auction storage auction = auctions[filterHash];
        if (auction.currentBidder != address(0)) {
            payable(auction.currentBidder).transfer(auction.currentBid);
            auction.currentBidder = address(0);
            auction.currentBid = 0;
        }
    }

    /**
     * @dev Helper function to check if an auction exists
     */
    function auctionExists(bytes32 filterHash) external view returns (bool) {
        return auctions[filterHash].currentBidder != address(0) || auctions[filterHash].currentBid > 0;
    }
}
