// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IInsuranceFundV2 {
    function availableInsurance(address asset) external view returns (uint256);

    function coverDeficit(address asset, uint256 requested, address recipient) external;

    function notifyForfeiture(address asset, uint256 amount) external;

    function notifyRevenueContribution(address asset, uint256 amount) external;

    function totalInsuranceFromForfeiture(address asset) external view returns (uint256);

    function totalInsuranceFromRevenue(address asset) external view returns (uint256);

    function totalInsuranceUsedForBadDebt(address asset) external view returns (uint256);

    event ForfeitureReceived(address indexed asset, uint256 amount);
    event RevenueContributionReceived(address indexed asset, uint256 amount);
    event DeficitCovered(address indexed asset, address indexed recipient, uint256 amount);

    error Unauthorized();
    error InsufficientInsuranceBalance();
    error ZeroAddress();
    error ZeroAmount();
    error DependencyAlreadySet();
    error InsufficientContributionReceived();
    error TokenReceiptMismatch();
}
