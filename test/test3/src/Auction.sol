// SPDX-License-Identifier: GPL-3.0 or above
pragma solidity ^0.8.24;
import "./ERC20.sol";
import "./ERC721.sol";

contract Auction {
    address private owner;
    NFT public auctionedToken;
    ERC20 public token;
    ERC721 public collection;

    struct NFT {
        uint256 tokenId;
    }
    constructor(ERC721 _collection, ERC20 _token, uint256 tokenId, address _owner) public {}
    function bid(uint256 amount) public payable {}
    function getWinner() public view returns (address) {}
    function getBid(address bidder) public view returns (uint256) {}
}
