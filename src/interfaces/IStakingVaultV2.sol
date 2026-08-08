// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IStakingVaultV2
/// @notice Frozen collateral-seizure and reward-index ABI for Shiny V2.
interface IStakingVaultV2 {
    function notifyReward(address asset, uint256 amount) external;

    function getSeizablePrincipal(address user, address asset, uint256[] calldata positionIds)
        external
        view
        returns (uint256);

    function getTotalSeizablePrincipal(address user, address asset) external view returns (uint256);

    function seizeStakedCollateral(
        address user,
        address asset,
        uint256[] calldata positionIds,
        uint256 amount,
        address recipient
    ) external returns (uint256 amountSeized);

    function accRewardPerWeightedShare(address asset) external view returns (uint256);

    function tierWeight(uint8 tier) external view returns (uint256);

    event PositionCollateralSeized(
        uint256 indexed positionId,
        address indexed user,
        address indexed asset,
        uint256 amountSeized,
        uint256 remainingPrincipal
    );

    error NotLendingPool();
    error PositionIdsNotSorted();
    error PositionIdsEmpty();
    error TooManyPositionIds();
    error PositionNotOwnedByUser();
    error PositionAssetMismatch();
    error PositionAlreadyWithdrawn();
    error InsufficientSelectedPrincipal();
    error PositionNotFound();
    error ZeroAmount();
    error ZeroAddress();
    error InvalidTier();
}
