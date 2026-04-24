// SPDX-License-Identifier: GPL-3.0 or above
pragma solidity ^0.8.24;

interface ERC20 {
    function transfer(address dst, uint256 amount) external;
    function balanceOf(address _owner) external view returns (uint256);
    function transferFrom(address src, address dst, uint256 amount) external;
    event Transfer(address _from, address _to, uint256 _value);
    event Approval(address _owner, address indexed _spender, uint256 _value);
}
