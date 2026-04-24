// SPDX-License-Identifier: GPL-3.0 or above
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Auction} from "../src/Auction.sol";
import {ZPunks} from "../src/boh/RealNFT.sol";
import {MyToken} from "../src/boh/realtoken.sol";
import {ERC721} from "../src/ERC721.sol";
import {ERC20} from "../src/ERC20.sol";

contract SystemInvariantTest is Test {
    Auction public auction;
    ZPunks public nft;
    MyToken public token;

    uint256 public ghost_bidSum;
    address ghost_max_bidder;

    address[] public bidders;
    address internal currentBidder;

    address owner;

    mapping(address => uint256) ghost_bids;

    modifier useBidder(uint256 bidderSeed) {
        currentBidder = bidders[bound(bidderSeed, 0, bidders.length - 1)];
        vm.startPrank(currentBidder);
        _;
        vm.stopPrank();
    }

    constructor() {
        token = new MyToken(10 ** 24);

        // Give each bidder tokens from the minted amount (no ether)
        for (uint256 i = 0; i < 10; i++) {
            address bidder = makeAddr(string(abi.encodePacked("bidder", i)));
            bidders.push(bidder);
            token.transfer(bidder, 100_000);
        }

        owner = makeAddr(string(abi.encodePacked("bidder", uint256(11))));
        nft = new ZPunks(owner);
        uint256 ntfId = nft.safeMint(owner, "ipfs://test");

        auction = new Auction(ERC721(address(nft)), ERC20(address(token)), ntfId, owner);
    }

    function bid(uint256 amount, uint256 bidderSeed) external useBidder(bidderSeed) {
        auction.bid(amount);

        ghost_bids[currentBidder] += amount;
        ghost_bidSum += amount;

        if (ghost_max_bidder == address(0) || ghost_bids[currentBidder] > ghost_bids[ghost_max_bidder]) {
            ghost_max_bidder = currentBidder;
        }
    }

    function invariant_bid() public view {
        for (uint256 i = 0; i < bidders.length; i++) {
            address bidder = bidders[i];
            assertEq(auction.getBid(bidder), ghost_bids[bidder]);
        }
    }

    function invariant_getWinner() public view {
        assertEq(ghost_max_bidder, auction.getWinner());
    }
}
