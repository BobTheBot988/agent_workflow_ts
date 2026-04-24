// SPDX-License-Identifier: GPL-3.0 or above
pragma solidity ^0.8.24;

interface ERC165 {
    function supportInterface(bytes4 interfaceID) external view returns (bool);
}
