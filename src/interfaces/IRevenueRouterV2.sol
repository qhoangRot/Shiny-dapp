// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IRevenueRouterV2 {
    function routeRevenue(address asset, uint256 amount)
        external
        returns (uint256 stakerAmount, uint256 treasuryAmount, uint256 insuranceAmount, uint256 creditAmount);

    event RevenueSettled(
        address indexed asset,
        uint256 totalAmount,
        uint256 stakerAmount,
        uint256 treasuryAmount,
        uint256 insuranceAmount,
        uint256 creditAmount
    );

    error Unauthorized();
    error ZeroAmount();
}
