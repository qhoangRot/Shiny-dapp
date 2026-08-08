// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ILendingPoolV2
/// @notice Frozen liquidation, revenue, and bad-debt ABI for Shiny V2.
interface ILendingPoolV2 {
    function liquidate(
        address user,
        address debtAsset,
        address collateralAsset,
        uint256 requestedDebtToCover,
        uint256[] calldata positionIds,
        uint256 minCollateralOut,
        uint256 deadline
    ) external returns (uint256 actualDebtCovered, uint256 collateralSeized);

    function settleRevenue(address asset) external returns (uint256 amountSettled);

    function finalizeBadDebt(address user, address debtAsset) external returns (uint256 deficitCreated);

    function resolveDeficitFromInsurance(address asset) external returns (uint256 amountCovered);

    function coverDeficit(address asset, uint256 amount) external returns (uint256 amountCovered);

    function canBorrow(address collateralAsset, address debtAsset) external view returns (bool);

    function protocolDeficit(address asset) external view returns (uint256);

    function totalBadDebtRealized(address asset) external view returns (uint256);

    function totalPerformingDebt(address asset) external view returns (uint256);

    function pendingRevenue(address asset) external view returns (uint256);

    event Liquidated(
        address indexed user,
        address indexed liquidator,
        address indexed debtAsset,
        address collateralAsset,
        uint256 debtCovered,
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 baseCollateral,
        uint256 liquidationBonus,
        uint256 collateralSeized,
        uint256 healthFactorBefore,
        uint256 healthFactorAfter,
        uint256 remainingUncoveredDebt
    );

    event BadDebtFinalized(
        address indexed user,
        address indexed debtAsset,
        uint256 principalLoss,
        uint256 interestLoss,
        uint256 resultingDeficit
    );

    event ProtocolDeficitCovered(
        address indexed asset, address indexed contributor, uint256 amountCovered, uint256 remainingDeficit
    );

    event DebtMarketRecovered(address indexed debtAsset);

    event RiskParameterUpdated(bytes32 indexed parameter, uint256 oldValue, uint256 newValue);

    error HealthFactorSafe();
    error BorrowPairNotSupported();
    error CollateralRemaining();
    error InvalidInsuranceTransfer();
    error SlippageExceeded();
    error DeadlineExpired();
    error PositionIdsNotSorted();
    error PositionIdsEmpty();
    error TooManyPositionIds();
    error TokenReceiptMismatch();
    error OracleUnhealthy();
    error DebtAssetSuspended();
    error ZeroAmount();
    error UnsupportedAsset();
    error NoActiveDebt();
    error NothingToFinalize();
    error NothingToSettle();
    error NothingToCover();
    error InsufficientCollateral();
    error WithdrawalWouldBeUnsafe();
    error HealthFactorNotImproved();
}
