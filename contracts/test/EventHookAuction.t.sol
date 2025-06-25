// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/EventHookAuction.sol";
import "../src/IHookConsumer.sol";

contract EventHookAuctionTest is Test {
    EventHookAuction public auction;
    address public owner;
    address public executor;
    address public bidder1;
    address public bidder2;

    // Example event filter for UniswapV4 Initialize
    EventFilter public initializeFilter;
    bytes32 public filterHash;

    function setUp() public {
        owner = makeAddr("owner");
        executor = makeAddr("executor");
        bidder1 = makeAddr("bidder1");
        bidder2 = makeAddr("bidder2");

        vm.prank(owner);
        auction = new EventHookAuction(executor);

        // Create a filter for UniswapV4 Initialize event
        // Initialize(PoolId indexed poolId, Currency indexed currency0, Currency indexed currency1, uint24 fee, int24 tickSpacing, IHooks hooks)
        initializeFilter = EventFilter({
            contractAddress: address(0x7Da1D65F8B249183667cdE74C5CBD46dD38AA829), // UniswapV4 PoolManager (Base Sepolia)
            topic0: keccak256("Initialize(bytes32,address,address,uint24,int24,address)"),
            topic1: bytes32(0), // Any poolId
            topic2: bytes32(uint256(uint160(address(0x4200000000000000000000000000000000000006)))), // WETH on Base
            topic3: bytes32(0), // Any currency1
            useTopic1: false, // Don't filter on poolId
            useTopic2: true,  // Filter on currency0 = WETH
            useTopic3: false  // Don't filter on currency1
        });

        filterHash = auction.getFilterHash(initializeFilter);
    }

    function testFirstBidCreatesAuction() public {
        // First bid should create the auction
        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        auction.placeBid{value: 1 ether}(initializeFilter);

        (
            address currentBidder,
            uint256 currentBid,
            uint256 minimumBid,
            uint256 lastBidTime,
            bool isActive,
            bool isExecuted,
            EventFilter memory filter
        ) = auction.getAuction(filterHash);

        assertEq(currentBidder, bidder1);
        assertEq(currentBid, 1 ether);
        assertEq(minimumBid, 1 ether); // First bid sets minimum
        assertTrue(isActive);
        assertEq(filter.contractAddress, initializeFilter.contractAddress);
        assertTrue(auction.auctionExists(filterHash));
    }

    function testSubsequentBids() public {
        // First bid creates auction
        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        auction.placeBid{value: 1 ether}(initializeFilter);

        // Second bid
        vm.deal(bidder2, 10 ether);
        vm.prank(bidder2);
        auction.placeBid{value: 1.01 ether}(initializeFilter);

        (address currentBidder, uint256 currentBid,,,,, ) = auction.getAuction(filterHash);
        assertEq(currentBidder, bidder2);
        assertEq(currentBid, 1.01 ether);
    }

    function testBidIncrement() public {
        // First bid creates auction
        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        auction.placeBid{value: 1 ether}(initializeFilter);

        // Second bid must be at least 1.01x higher
        vm.deal(bidder2, 10 ether);
        vm.prank(bidder2);
        vm.expectRevert(abi.encodeWithSelector(EventHookAuction.BidTooLow.selector, 1.01 ether, 1.005 ether));
        auction.placeBid{value: 1.005 ether}(initializeFilter);

        // Valid higher bid
        vm.prank(bidder2);
        auction.placeBid{value: 1.01 ether}(initializeFilter);

        (address currentBidder, uint256 currentBid,,,,, ) = auction.getAuction(filterHash);
        assertEq(currentBidder, bidder2);
        assertEq(currentBid, 1.01 ether);
    }

    function testBidRefund() public {
        // First bid
        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        auction.placeBid{value: 1 ether}(initializeFilter);

        uint256 bidder1BalanceBefore = bidder1.balance;

        // Second bid should refund first bidder
        vm.deal(bidder2, 10 ether);
        vm.prank(bidder2);
        auction.placeBid{value: 1.01 ether}(initializeFilter);

        assertEq(bidder1.balance, bidder1BalanceBefore + 1 ether);
    }


    function testAuctionExists() public {
        assertFalse(auction.auctionExists(filterHash));

        // First bid creates auction
        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        auction.placeBid{value: 1 ether}(initializeFilter);

        assertTrue(auction.auctionExists(filterHash));
    }

    function testGetWinner() public {
        assertEq(auction.getWinner(filterHash), address(0));

        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        auction.placeBid{value: 1 ether}(initializeFilter);

        assertEq(auction.getWinner(filterHash), bidder1);
    }

    function testInvalidBids() public {
        EventFilter memory invalidFilter = initializeFilter;
        
        // Test invalid contract address
        invalidFilter.contractAddress = address(0);
        vm.deal(bidder1, 10 ether);
        vm.prank(bidder1);
        vm.expectRevert(EventHookAuction.InvalidContractAddress.selector);
        auction.placeBid{value: 1 ether}(invalidFilter);

        // Test invalid topic0
        invalidFilter.contractAddress = initializeFilter.contractAddress;
        invalidFilter.topic0 = bytes32(0);
        vm.prank(bidder1);
        vm.expectRevert(EventHookAuction.InvalidTopic0.selector);
        auction.placeBid{value: 1 ether}(invalidFilter);

        // Test zero bid
        vm.prank(bidder1);
        vm.expectRevert(EventHookAuction.ZeroBid.selector);
        auction.placeBid{value: 0}(initializeFilter);
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