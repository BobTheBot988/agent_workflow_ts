// SPDX-License-Identifier: GPL-3.0 or above
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract Auction is IERC721Receiver {
    address private owner;
    NFT public auctionedToken;
    IERC20 public token;
    IERC721 public collection;

    mapping(address => uint256) private bids;
    address private winner;
    uint256 private highestBid;

    struct NFT {
        uint256 tokenId;
    }

    constructor(IERC721 _collection, IERC20 _token, uint256 tokenId, address /*_owner*/) {
        collection = _collection;
        token = _token;
        auctionedToken = NFT({tokenId: tokenId});
        // NFT must already be transferred to this contract by the caller
    }

    // Implements IERC721Receiver
    function onERC721Received(address, address, uint256, bytes memory) public pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function bid(uint256 amount) public payable {
        // Must send at least some value
        require(amount > 0, "Bid must be greater than 0");

        // Refund previous bid if this bidder already bid
        if (bids[msg.sender] > 0) {
            require(amount > bids[msg.sender], "New bid must be higher than existing bid");
            token.transfer(msg.sender, bids[msg.sender]);
        }

        // Transfer tokens from bidder to this contract
        bool success = token.transferFrom(msg.sender, address(this), amount);
        require(success, "Token transfer failed");

        // Update bid
        bids[msg.sender] = amount;

        // Update winner if this is highest bid
        if (amount > highestBid) {
            highestBid = amount;
            winner = msg.sender;
        }
    }

    function getWinner() public view returns (address) {
        return winner;
    }

    function getBid(address bidder) public view returns (uint256) {
        return bids[bidder];
    }
}
