// SPDX-License-Identifier: GPL-3.0 or above
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract Auction {
    address private owner;
    NFT public auctionedToken;
    IERC20 public token;
    IERC721 public collection;

    struct NFT {
        uint256 tokenId;
    }
    constructor(IERC721 _collection, IERC20 _token, uint256 tokenId, address _owner) {}
    function bid(uint256 amount) public {}
    function getWinner() public view returns (address) {}
    function getBid(address bidder) public view returns (uint256) {}
}
