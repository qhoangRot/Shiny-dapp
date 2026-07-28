// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Common FX oracle interface used by LendingPool.
/// @dev Implementations may read a third-party feed or an explicitly simulated testnet price.
interface IPriceOracle {
    function getPrice() external returns (uint256 price);
    function viewPrice() external view returns (uint256 price, uint256 timestamp);
}
