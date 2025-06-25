// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/EventHookAuction.sol";

contract EventHookAuctionTest is Test {
    EventHookAuction public auction;
    address public owner;
    address public bidder1;
    address public bidder2;

    // Example event filter for UniswapV3 PoolCreated
    EventHookAuction.EventFilter public poolCreatedFilter;
    bytes32 public filterHash;

    function setUp() public {
        owner = makeAddr("owner");
        bidder1 = makeAddr("bidder1");
        bidder2 = makeAddr("bidder2");

        vm.prank(owner);
        auction = new EventHookAuction();

        // Create a filter for UniswapV3 PoolCreated event
        // PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)
        poolCreatedFilter = EventHookAuction.EventFilter({
            contractAddress: address(0x1F98431c8aD98523631AE4a59f267346ea31F984), // UniswapV3Factory
            topic0: keccak256("PoolCreated(address,address,uint24,int24,address)"),
            topic1: bytes32(uint256(uint160(address(0xA0b86a33E6411e3036)))), // WETH
            topic2: bytes32(0), // Any token1
            topic3: bytes32(uint256(3000)), // 0.3% fee tier
            useTopic1: true,  // Filter on token0 = WETH
            useTopic2: false, // Don't filter on token1
            useTopic3: true   // Filter on fee = 3000
        });

        filterHash = auction.getFilterHash(poolCreatedFilter);
    }

    function testFirstBidCreatesAuction() public {
        // First bid should create the auction
        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        auction.placeBid{value: 1 ether}(poolCreatedFilter);

        (
            address currentBidder,
            uint256 currentBid,
            uint256 minimumBid,
            uint256 lastBidTime,
            bool isActive,
            EventHookAuction.EventFilter memory filter
        ) = auction.getAuction(filterHash);

        assertEq(currentBidder, bidder1);
        assertEq(currentBid, 1 ether);
        assertEq(minimumBid, 1 ether); // First bid sets minimum
        assertTrue(isActive);
        assertEq(filter.contractAddress, poolCreatedFilter.contractAddress);
        assertTrue(auction.auctionExists(filterHash));
    }

    function testSubsequentBids() public {
        // First bid creates auction
        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        auction.placeBid{value: 1 ether}(poolCreatedFilter);

        // Second bid
        vm.deal(bidder2, 10 ether);
        vm.prank(bidder2);
        auction.placeBid{value: 1.01 ether}(poolCreatedFilter);

        (address currentBidder, uint256 currentBid,,,, ) = auction.getAuction(filterHash);
        assertEq(currentBidder, bidder2);
        assertEq(currentBid, 1.01 ether);
    }

    function testBidIncrement() public {
        // First bid creates auction
        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        auction.placeBid{value: 1 ether}(poolCreatedFilter);

        // Second bid must be at least 1.01x higher
        vm.deal(bidder2, 10 ether);
        vm.prank(bidder2);
        vm.expectRevert(abi.encodeWithSelector(EventHookAuction.BidTooLow.selector, 1.01 ether, 1.005 ether));
        auction.placeBid{value: 1.005 ether}(poolCreatedFilter);

        // Valid higher bid
        vm.prank(bidder2);
        auction.placeBid{value: 1.01 ether}(poolCreatedFilter);

        (address currentBidder, uint256 currentBid,,,, ) = auction.getAuction(filterHash);
        assertEq(currentBidder, bidder2);
        assertEq(currentBid, 1.01 ether);
    }

    function testBidRefund() public {
        // First bid
        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        auction.placeBid{value: 1 ether}(poolCreatedFilter);

        uint256 bidder1BalanceBefore = bidder1.balance;

        // Second bid should refund first bidder
        vm.deal(bidder2, 10 ether);
        vm.prank(bidder2);
        auction.placeBid{value: 1.01 ether}(poolCreatedFilter);

        assertEq(bidder1.balance, bidder1BalanceBefore + 1 ether);
    }


    function testAuctionExists() public {
        assertFalse(auction.auctionExists(filterHash));

        // First bid creates auction
        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        auction.placeBid{value: 1 ether}(poolCreatedFilter);

        assertTrue(auction.auctionExists(filterHash));
    }

    function testGetWinner() public {
        assertEq(auction.getWinner(filterHash), address(0));

        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        auction.placeBid{value: 1 ether}(poolCreatedFilter);

        assertEq(auction.getWinner(filterHash), bidder1);
    }

    function testInvalidBids() public {
        EventHookAuction.EventFilter memory invalidFilter = poolCreatedFilter;
        
        // Test invalid contract address
        invalidFilter.contractAddress = address(0);
        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        vm.expectRevert(EventHookAuction.InvalidContractAddress.selector);
        auction.placeBid{value: 1 ether}(invalidFilter);

        // Test invalid topic0
        invalidFilter.contractAddress = poolCreatedFilter.contractAddress;
        invalidFilter.topic0 = bytes32(0);
        vm.prank(bidder1);
        vm.expectRevert(EventHookAuction.InvalidTopic0.selector);
        auction.placeBid{value: 1 ether}(invalidFilter);

        // Test zero bid
        vm.prank(bidder1);
        vm.expectRevert(EventHookAuction.ZeroBid.selector);
        auction.placeBid{value: 0}(poolCreatedFilter);
    }

    function testOnlyOwnerFunctions() public {
        vm.expectRevert(EventHookAuction.OnlyOwner.selector);
        auction.setAuctionActive(filterHash, false);

        vm.expectRevert(EventHookAuction.OnlyOwner.selector);
        auction.withdraw();

        vm.expectRevert(EventHookAuction.OnlyOwner.selector);
        auction.emergencyRefund(filterHash);
    }
}