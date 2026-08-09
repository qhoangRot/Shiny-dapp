// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILendingPoolV2} from "./interfaces/ILendingPoolV2.sol";
import {IStakingVaultV2} from "./interfaces/IStakingVaultV2.sol";
import {IOracleV2} from "./interfaces/IOracleV2.sol";
import {IRevenueRouterV2} from "./interfaces/IRevenueRouterV2.sol";
import {IInsuranceFundV2} from "./interfaces/IInsuranceFundV2.sol";
import {LiquidationMath} from "./libraries/LiquidationMath.sol";

/// @title LendingPoolV2
/// @notice Cross-asset lending backed by positions held in StakingVaultV2.
contract LendingPoolV2 is ILendingPoolV2, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant HF_PRECISION = 1e18;
    uint256 public constant MAX_ELIGIBLE_COLLATERAL_ASSETS = 16;
    uint256 public constant MAX_POSITION_IDS = 32;
    uint256 public constant MAX_BORROW_RATE_PER_SECOND = 1e15;

    uint256 public maxLtvBps = 7_500;
    uint256 public liquidationThresholdBps = 8_330;
    uint256 public liquidationBonusBps = 500;
    uint256 public standardCloseFactorBps = 5_000;
    uint256 public fullLiquidationHfThreshold = 0.95e18;

    bytes32 public constant MAX_LTV_BPS_KEY = keccak256("MAX_LTV_BPS");
    bytes32 public constant LIQUIDATION_THRESHOLD_BPS_KEY = keccak256("LIQUIDATION_THRESHOLD_BPS");
    bytes32 public constant LIQUIDATION_BONUS_BPS_KEY = keccak256("LIQUIDATION_BONUS_BPS");
    bytes32 public constant CLOSE_FACTOR_BPS_KEY = keccak256("CLOSE_FACTOR_BPS");
    bytes32 public constant FULL_LIQUIDATION_HF_KEY = keccak256("FULL_LIQUIDATION_HF");

    struct Loan {
        uint256 principal;
        uint256 accruedInterest;
        uint256 lastAccrualTime;
        bool active;
    }

    struct PriceSnapshot {
        uint256 usdcPriceWad;
        uint256 eurcPriceWad;
    }

    struct LiquidationCache {
        PriceSnapshot prices;
        LiquidationMath.Quote quote;
        uint256 healthFactorBefore;
        uint256 healthFactorAfter;
        uint256 totalDebtValueBefore;
        uint256 outstandingDebt;
        uint256 selectedPrincipal;
        uint256 principalPaid;
        uint256 interestPaid;
        bool economicDeficit;
    }

    struct LiquidationRequest {
        address user;
        address debtAsset;
        address collateralAsset;
        uint256 requestedDebtToCover;
        uint256[] positionIds;
        uint256 minCollateralOut;
        uint256 deadline;
    }

    address public immutable usdc;
    address public immutable eurc;
    IStakingVaultV2 public immutable stakingVault;
    IOracleV2 public immutable oracle;
    IRevenueRouterV2 public immutable revenueRouter;
    IInsuranceFundV2 public immutable insuranceFund;

    mapping(address => uint256) public assetUnit;
    mapping(address => bool) public supportedAssets;
    mapping(address => uint256) public borrowRatePerSecond;
    mapping(address => bool) public governanceBorrowPaused;
    mapping(address => mapping(address => bool)) public isBorrowPairEnabled;
    mapping(address => mapping(address => bool)) public isEligibleCollateralForDebt;
    mapping(address => address[]) private _eligibleCollateralAssets;

    mapping(address => mapping(address => Loan)) public loans;
    mapping(address => uint256) public totalInterestCollected;
    mapping(address => uint256) public override pendingRevenue;
    mapping(address => uint256) public override protocolDeficit;
    mapping(address => uint256) public override totalBadDebtRealized;
    mapping(address => uint256) public totalBadDebtCovered;
    mapping(address => uint256) public override totalPerformingDebt;

    event LiquidityFunded(address indexed asset, address indexed funder, uint256 amount);
    event Borrowed(address indexed user, address indexed debtAsset, uint256 amount);
    event Repaid(
        address indexed user, address indexed debtAsset, uint256 amount, uint256 principalPaid, uint256 interestPaid
    );
    event BorrowPairConfigured(address indexed collateralAsset, address indexed debtAsset, bool enabled);
    event BorrowAssetPauseUpdated(address indexed debtAsset, bool paused);
    event BorrowRateUpdated(address indexed debtAsset, uint256 oldRate, uint256 newRate);

    error Unauthorized();
    error ZeroAddress();
    error InsufficientLiquidity();
    error InvalidRiskParameter();
    error InvalidTokenDecimals();
    error MaxEligibleCollateralAssetsExceeded();

    constructor(
        address initialOwner,
        address usdcAddress,
        address eurcAddress,
        address stakingVaultAddress,
        address oracleAdapter,
        address revenueRouterAddress,
        address insuranceFundAddress
    ) Ownable(initialOwner) {
        if (
            initialOwner == address(0) || usdcAddress == address(0) || eurcAddress == address(0)
                || stakingVaultAddress == address(0) || oracleAdapter == address(0)
                || revenueRouterAddress == address(0) || insuranceFundAddress == address(0)
        ) revert ZeroAddress();
        if (usdcAddress == eurcAddress) revert UnsupportedAsset();

        usdc = usdcAddress;
        eurc = eurcAddress;
        stakingVault = IStakingVaultV2(stakingVaultAddress);
        oracle = IOracleV2(oracleAdapter);
        revenueRouter = IRevenueRouterV2(revenueRouterAddress);
        insuranceFund = IInsuranceFundV2(insuranceFundAddress);
        supportedAssets[usdcAddress] = true;
        supportedAssets[eurcAddress] = true;
        assetUnit[usdcAddress] = _readAssetUnit(usdcAddress);
        assetUnit[eurcAddress] = _readAssetUnit(eurcAddress);

        _configureBorrowPair(usdcAddress, eurcAddress, true);
        _configureBorrowPair(eurcAddress, usdcAddress, true);
    }

    modifier onlyStakingVault() {
        if (msg.sender != address(stakingVault)) revert Unauthorized();
        _;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function configureBorrowPair(address collateralAsset, address debtAsset, bool enabled) external onlyOwner {
        _requireSupportedAsset(collateralAsset);
        _requireSupportedAsset(debtAsset);
        _configureBorrowPair(collateralAsset, debtAsset, enabled);
    }

    function setBorrowAssetPaused(address debtAsset, bool isPaused) external onlyOwner {
        _requireSupportedAsset(debtAsset);
        governanceBorrowPaused[debtAsset] = isPaused;
        emit BorrowAssetPauseUpdated(debtAsset, isPaused);
    }

    function setBorrowRatePerSecond(address debtAsset, uint256 newRate) external onlyOwner {
        _requireSupportedAsset(debtAsset);
        if (newRate > MAX_BORROW_RATE_PER_SECOND) revert InvalidRiskParameter();
        uint256 oldRate = borrowRatePerSecond[debtAsset];
        borrowRatePerSecond[debtAsset] = newRate;
        emit BorrowRateUpdated(debtAsset, oldRate, newRate);
    }

    function setRiskParameters(
        uint256 newMaxLtvBps,
        uint256 newLiquidationThresholdBps,
        uint256 newLiquidationBonusBps,
        uint256 newStandardCloseFactorBps,
        uint256 newFullLiquidationHfThreshold
    ) external onlyOwner {
        if (
            newMaxLtvBps == 0 || newMaxLtvBps >= newLiquidationThresholdBps
                || newLiquidationThresholdBps > BPS_DENOMINATOR
        ) revert InvalidRiskParameter();
        LiquidationMath.validateRiskParameters(
            newLiquidationBonusBps, newStandardCloseFactorBps, newFullLiquidationHfThreshold
        );

        _emitRiskUpdate(MAX_LTV_BPS_KEY, maxLtvBps, newMaxLtvBps);
        _emitRiskUpdate(LIQUIDATION_THRESHOLD_BPS_KEY, liquidationThresholdBps, newLiquidationThresholdBps);
        _emitRiskUpdate(LIQUIDATION_BONUS_BPS_KEY, liquidationBonusBps, newLiquidationBonusBps);
        _emitRiskUpdate(CLOSE_FACTOR_BPS_KEY, standardCloseFactorBps, newStandardCloseFactorBps);
        _emitRiskUpdate(FULL_LIQUIDATION_HF_KEY, fullLiquidationHfThreshold, newFullLiquidationHfThreshold);

        maxLtvBps = newMaxLtvBps;
        liquidationThresholdBps = newLiquidationThresholdBps;
        liquidationBonusBps = newLiquidationBonusBps;
        standardCloseFactorBps = newStandardCloseFactorBps;
        fullLiquidationHfThreshold = newFullLiquidationHfThreshold;
    }

    function fundLiquidity(address asset, uint256 amount) external nonReentrant {
        _requireSupportedAsset(asset);
        if (amount == 0) revert ZeroAmount();
        _pullExact(asset, msg.sender, amount);
        emit LiquidityFunded(asset, msg.sender, amount);
    }

    function availableLiquidity(address asset) public view returns (uint256) {
        uint256 balance = IERC20(asset).balanceOf(address(this));
        uint256 reserved = pendingRevenue[asset];
        return balance > reserved ? balance - reserved : 0;
    }

    function borrow(address collateralAsset, address debtAsset, uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!_canBorrow(collateralAsset, debtAsset)) {
            if (!isBorrowPairEnabled[collateralAsset][debtAsset]) {
                revert BorrowPairNotSupported();
            }
            revert DebtAssetSuspended();
        }
        if (availableLiquidity(debtAsset) < amount) revert InsufficientLiquidity();

        _accrueAll(msg.sender);
        PriceSnapshot memory prices = _takePriceSnapshot();
        Loan storage loan = loans[msg.sender][debtAsset];
        loan.principal += amount;
        loan.active = true;
        if (loan.lastAccrualTime == 0) loan.lastAccrualTime = block.timestamp;
        totalPerformingDebt[debtAsset] += amount;

        (uint256 collateralValueWad,, uint256 debtValueWad) = _portfolioValues(msg.sender, prices, address(0), 0);
        if (collateralValueWad == 0) revert InsufficientCollateral();
        uint256 ltvBps = Math.mulDiv(debtValueWad, BPS_DENOMINATOR, collateralValueWad);
        if (ltvBps > maxLtvBps) revert InsufficientCollateral();

        IERC20(debtAsset).safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, debtAsset, amount);
    }

    function repay(address debtAsset, uint256 amount) external nonReentrant returns (uint256 amountRepaid) {
        _requireSupportedAsset(debtAsset);
        if (amount == 0) revert ZeroAmount();
        _accrue(msg.sender, debtAsset);
        Loan storage loan = loans[msg.sender][debtAsset];
        uint256 outstanding = loan.principal + loan.accruedInterest;
        if (outstanding == 0) revert NoActiveDebt();

        amountRepaid = amount < outstanding ? amount : outstanding;
        _pullExact(debtAsset, msg.sender, amountRepaid);
        (uint256 principalPaid, uint256 interestPaid) = _applyDebtPayment(loan, amountRepaid);
        totalPerformingDebt[debtAsset] -= amountRepaid;
        totalInterestCollected[debtAsset] += interestPaid;
        pendingRevenue[debtAsset] += interestPaid;

        emit Repaid(msg.sender, debtAsset, amountRepaid, principalPaid, interestPaid);
    }

    function validateWithdrawal(address user, address asset, uint256 amount) external onlyStakingVault nonReentrant {
        _requireSupportedAsset(asset);
        if (amount == 0) revert ZeroAmount();
        _accrueAll(user);
        if (_rawDebt(user, usdc) + _rawDebt(user, eurc) == 0) return;

        PriceSnapshot memory prices = _takePriceSnapshot();
        (, uint256 adjustedCollateralValueWad, uint256 debtValueWad) = _portfolioValues(user, prices, asset, amount);
        if (LiquidationMath.healthFactor(adjustedCollateralValueWad, debtValueWad) < HF_PRECISION) {
            revert WithdrawalWouldBeUnsafe();
        }
    }

    function liquidate(
        address user,
        address debtAsset,
        address collateralAsset,
        uint256 requestedDebtToCover,
        uint256[] calldata positionIds,
        uint256 minCollateralOut,
        uint256 deadline
    ) external override nonReentrant returns (uint256 actualDebtCovered, uint256 collateralSeized) {
        LiquidationRequest memory request = LiquidationRequest({
            user: user,
            debtAsset: debtAsset,
            collateralAsset: collateralAsset,
            requestedDebtToCover: requestedDebtToCover,
            positionIds: positionIds,
            minCollateralOut: minCollateralOut,
            deadline: deadline
        });
        return _executeLiquidation(request);
    }

    function _executeLiquidation(LiquidationRequest memory request)
        internal
        returns (uint256 actualDebtCovered, uint256 collateralSeized)
    {
        // Timestamp-based expiry is intentional slippage protection; validators
        // cannot gain custody or bypass any risk check through small timestamp drift.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > request.deadline) revert DeadlineExpired();
        if (!isEligibleCollateralForDebt[request.collateralAsset][request.debtAsset]) {
            revert BorrowPairNotSupported();
        }
        if (request.requestedDebtToCover == 0) revert ZeroAmount();
        _validatePositionIds(request.positionIds);

        _accrueAll(request.user);
        LiquidationCache memory cache;
        cache.prices = _takePriceSnapshot();
        cache.selectedPrincipal =
            stakingVault.getSeizablePrincipal(request.user, request.collateralAsset, request.positionIds);
        uint256 adjustedCollateralBefore;
        (, adjustedCollateralBefore, cache.totalDebtValueBefore) =
            _portfolioValues(request.user, cache.prices, address(0), 0);
        cache.healthFactorBefore = LiquidationMath.healthFactor(adjustedCollateralBefore, cache.totalDebtValueBefore);
        if (cache.healthFactorBefore >= HF_PRECISION) revert HealthFactorSafe();

        Loan storage loan = loans[request.user][request.debtAsset];
        cache.outstandingDebt = loan.principal + loan.accruedInterest;
        if (cache.outstandingDebt == 0) revert NoActiveDebt();

        cache.quote = _buildLiquidationQuote(
            request.debtAsset,
            request.collateralAsset,
            request.requestedDebtToCover,
            cache.selectedPrincipal,
            cache.prices,
            cache.healthFactorBefore,
            cache.outstandingDebt
        );
        actualDebtCovered = cache.quote.actualDebtToCover;
        collateralSeized = cache.quote.collateralToSeize;
        if (collateralSeized < request.minCollateralOut) revert SlippageExceeded();

        cache.economicDeficit = _isEconomicDeficit(request.user, cache.prices, cache.totalDebtValueBefore);

        (cache.principalPaid, cache.interestPaid) = _applyDebtPayment(loan, actualDebtCovered);
        totalPerformingDebt[request.debtAsset] -= actualDebtCovered;
        totalInterestCollected[request.debtAsset] += cache.interestPaid;
        pendingRevenue[request.debtAsset] += cache.interestPaid;

        _pullExact(request.debtAsset, msg.sender, actualDebtCovered);
        uint256 seized = stakingVault.seizeStakedCollateral(
            request.user, request.collateralAsset, request.positionIds, collateralSeized, msg.sender
        );
        if (seized != collateralSeized) revert TokenReceiptMismatch();

        uint256 adjustedCollateralAfter;
        uint256 totalDebtValueAfter;
        (, adjustedCollateralAfter, totalDebtValueAfter) = _portfolioValues(request.user, cache.prices, address(0), 0);
        cache.healthFactorAfter = LiquidationMath.healthFactor(adjustedCollateralAfter, totalDebtValueAfter);
        if (!cache.economicDeficit && cache.healthFactorAfter <= cache.healthFactorBefore) {
            revert HealthFactorNotImproved();
        }

        _emitLiquidation(request, cache, actualDebtCovered, collateralSeized, loan.principal + loan.accruedInterest);
    }

    function settleRevenue(address asset) external override nonReentrant returns (uint256 amountSettled) {
        _requireSupportedAsset(asset);
        amountSettled = pendingRevenue[asset];
        if (amountSettled == 0) revert NothingToSettle();

        pendingRevenue[asset] = 0;
        IERC20(asset).safeTransfer(address(revenueRouter), amountSettled);
        revenueRouter.routeRevenue(asset, amountSettled);
    }

    /// @notice Realizes debt only after every configured collateral source is physically empty.
    /// @dev Oracle health is intentionally not consulted: this proof uses raw seizable
    ///      principal, not a price conversion, so a stale oracle cannot cause collateral
    ///      to be treated as worthless or block finalization after collateral is exhausted.
    function finalizeBadDebt(address user, address debtAsset)
        external
        override
        nonReentrant
        returns (uint256 deficitCreated)
    {
        _requireSupportedAsset(debtAsset);
        _accrue(user, debtAsset);

        address[] storage collateralAssets = _eligibleCollateralAssets[debtAsset];
        for (uint256 i; i < collateralAssets.length; ++i) {
            if (stakingVault.getTotalSeizablePrincipal(user, collateralAssets[i]) != 0) {
                revert CollateralRemaining();
            }
        }

        Loan storage loan = loans[user][debtAsset];
        uint256 principalLoss = loan.principal;
        uint256 interestLoss = loan.accruedInterest;
        deficitCreated = principalLoss + interestLoss;
        if (deficitCreated == 0) revert NothingToFinalize();

        loan.principal = 0;
        loan.accruedInterest = 0;
        loan.active = false;
        loan.lastAccrualTime = block.timestamp;
        totalPerformingDebt[debtAsset] -= deficitCreated;
        totalBadDebtRealized[debtAsset] += deficitCreated;
        protocolDeficit[debtAsset] += deficitCreated;

        emit BadDebtFinalized(user, debtAsset, principalLoss, interestLoss, protocolDeficit[debtAsset]);
    }

    function resolveDeficitFromInsurance(address asset) external override nonReentrant returns (uint256 amountCovered) {
        _requireSupportedAsset(asset);
        uint256 deficit = protocolDeficit[asset];
        if (deficit == 0) revert NothingToCover();
        uint256 available = insuranceFund.availableInsurance(asset);
        uint256 requested = available < deficit ? available : deficit;
        if (requested == 0) revert InvalidInsuranceTransfer();

        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
        insuranceFund.coverDeficit(asset, requested, address(this));
        amountCovered = IERC20(asset).balanceOf(address(this)) - balanceBefore;
        if (amountCovered == 0 || amountCovered > requested) revert InvalidInsuranceTransfer();

        _recordDeficitCoverage(asset, address(insuranceFund), amountCovered);
    }

    function coverDeficit(address asset, uint256 amount)
        external
        override
        nonReentrant
        returns (uint256 amountCovered)
    {
        _requireSupportedAsset(asset);
        if (amount == 0) revert ZeroAmount();
        uint256 deficit = protocolDeficit[asset];
        if (deficit == 0) revert NothingToCover();
        amountCovered = amount < deficit ? amount : deficit;
        _pullExact(asset, msg.sender, amountCovered);
        _recordDeficitCoverage(asset, msg.sender, amountCovered);
    }

    function canBorrow(address collateralAsset, address debtAsset) external view override returns (bool) {
        return _canBorrow(collateralAsset, debtAsset);
    }

    function eligibleCollateralAssets(address debtAsset) external view returns (address[] memory) {
        return _eligibleCollateralAssets[debtAsset];
    }

    function getCurrentDebt(address user, address debtAsset)
        external
        view
        returns (uint256 principal, uint256 storedInterest, uint256 pendingInterest)
    {
        Loan storage loan = loans[user][debtAsset];
        principal = loan.principal;
        storedInterest = loan.accruedInterest;
        // This comparison only previews linear accrual and does not authorize value movement.
        // forge-lint: disable-next-line(block-timestamp)
        if (loan.active && block.timestamp > loan.lastAccrualTime) {
            pendingInterest = _calculateInterest(
                loan.principal, borrowRatePerSecond[debtAsset], block.timestamp - loan.lastAccrualTime
            );
        }
    }

    function _configureBorrowPair(address collateralAsset, address debtAsset, bool enabled) internal {
        if (!isEligibleCollateralForDebt[collateralAsset][debtAsset]) {
            address[] storage assets = _eligibleCollateralAssets[debtAsset];
            if (assets.length >= MAX_ELIGIBLE_COLLATERAL_ASSETS) {
                revert MaxEligibleCollateralAssetsExceeded();
            }
            isEligibleCollateralForDebt[collateralAsset][debtAsset] = true;
            assets.push(collateralAsset);
        }
        isBorrowPairEnabled[collateralAsset][debtAsset] = enabled;
        emit BorrowPairConfigured(collateralAsset, debtAsset, enabled);
    }

    function _canBorrow(address collateralAsset, address debtAsset) internal view returns (bool) {
        if (!isBorrowPairEnabled[collateralAsset][debtAsset]) return false;
        if (paused() || governanceBorrowPaused[debtAsset] || protocolDeficit[debtAsset] != 0) {
            return false;
        }
        try oracle.isHealthy(collateralAsset) returns (bool collateralHealthy) {
            if (!collateralHealthy) return false;
        } catch {
            return false;
        }
        try oracle.isHealthy(debtAsset) returns (bool debtHealthy) {
            return debtHealthy;
        } catch {
            return false;
        }
    }

    function _takePriceSnapshot() internal returns (PriceSnapshot memory prices) {
        if (!oracle.isHealthy(usdc) || !oracle.isHealthy(eurc)) revert OracleUnhealthy();
        uint256 usdcUpdatedAt;
        uint256 eurcUpdatedAt;
        (prices.usdcPriceWad, usdcUpdatedAt) = oracle.getValidatedPrice(usdc);
        (prices.eurcPriceWad, eurcUpdatedAt) = oracle.getValidatedPrice(eurc);
        if (prices.usdcPriceWad == 0 || prices.eurcPriceWad == 0 || usdcUpdatedAt == 0 || eurcUpdatedAt == 0) {
            revert OracleUnhealthy();
        }
    }

    function _portfolioValues(
        address user,
        PriceSnapshot memory prices,
        address withdrawalAsset,
        uint256 withdrawalAmount
    ) internal view returns (uint256 collateralValueWad, uint256 adjustedCollateralValueWad, uint256 debtValueWad) {
        uint256 usdcDebt = _rawDebt(user, usdc);
        uint256 eurcDebt = _rawDebt(user, eurc);
        if (usdcDebt != 0) {
            debtValueWad += LiquidationMath.assetValueWad(usdcDebt, prices.usdcPriceWad, assetUnit[usdc]);
        }
        if (eurcDebt != 0) {
            debtValueWad += LiquidationMath.assetValueWad(eurcDebt, prices.eurcPriceWad, assetUnit[eurc]);
        }

        collateralValueWad = _activeCollateralValue(user, usdc, prices.usdcPriceWad, withdrawalAsset, withdrawalAmount);
        collateralValueWad += _activeCollateralValue(user, eurc, prices.eurcPriceWad, withdrawalAsset, withdrawalAmount);
        adjustedCollateralValueWad = Math.mulDiv(collateralValueWad, liquidationThresholdBps, BPS_DENOMINATOR);
    }

    function _activeCollateralValue(
        address user,
        address collateralAsset,
        uint256 priceWad,
        address withdrawalAsset,
        uint256 withdrawalAmount
    ) internal view returns (uint256) {
        if (!_backsAnyActiveDebt(user, collateralAsset)) return 0;
        uint256 principal = stakingVault.getTotalSeizablePrincipal(user, collateralAsset);
        if (collateralAsset == withdrawalAsset) {
            principal = withdrawalAmount < principal ? principal - withdrawalAmount : 0;
        }
        return LiquidationMath.assetValueWad(principal, priceWad, assetUnit[collateralAsset]);
    }

    function _backsAnyActiveDebt(address user, address collateralAsset) internal view returns (bool) {
        return (_rawDebt(user, usdc) != 0 && isEligibleCollateralForDebt[collateralAsset][usdc])
            || (_rawDebt(user, eurc) != 0 && isEligibleCollateralForDebt[collateralAsset][eurc]);
    }

    function _isEconomicDeficit(address user, PriceSnapshot memory prices, uint256 totalDebtValueWad)
        internal
        view
        returns (bool)
    {
        uint256[] memory values = new uint256[](2);
        uint256[] memory bonuses = new uint256[](2);
        if (_backsAnyActiveDebt(user, usdc)) {
            values[0] = LiquidationMath.assetValueWad(
                stakingVault.getTotalSeizablePrincipal(user, usdc), prices.usdcPriceWad, assetUnit[usdc]
            );
        }
        if (_backsAnyActiveDebt(user, eurc)) {
            values[1] = LiquidationMath.assetValueWad(
                stakingVault.getTotalSeizablePrincipal(user, eurc), prices.eurcPriceWad, assetUnit[eurc]
            );
        }
        bonuses[0] = liquidationBonusBps;
        bonuses[1] = liquidationBonusBps;
        return LiquidationMath.isEconomicDeficit(values, bonuses, totalDebtValueWad);
    }

    function _buildLiquidationQuote(
        address debtAsset,
        address collateralAsset,
        uint256 requestedDebtToCover,
        uint256 selectedPrincipal,
        PriceSnapshot memory prices,
        uint256 healthFactorBefore,
        uint256 outstandingDebt
    ) internal view returns (LiquidationMath.Quote memory) {
        uint256 closeFactor = LiquidationMath.effectiveCloseFactorBps(
            healthFactorBefore, fullLiquidationHfThreshold, standardCloseFactorBps
        );
        return LiquidationMath.quote(
            LiquidationMath.QuoteParams({
                requestedDebtToCover: requestedDebtToCover,
                outstandingDebt: outstandingDebt,
                selectedCollateral: selectedPrincipal,
                debtPriceWad: _priceOf(prices, debtAsset),
                collateralPriceWad: _priceOf(prices, collateralAsset),
                debtUnit: assetUnit[debtAsset],
                collateralUnit: assetUnit[collateralAsset],
                liquidationBonusBps: liquidationBonusBps,
                effectiveCloseFactorBps: closeFactor
            })
        );
    }

    function _emitLiquidation(
        LiquidationRequest memory request,
        LiquidationCache memory cache,
        uint256 actualDebtCovered,
        uint256 collateralSeized,
        uint256 remainingDebt
    ) internal {
        emit Liquidated(
            request.user,
            msg.sender,
            request.debtAsset,
            request.collateralAsset,
            actualDebtCovered,
            cache.principalPaid,
            cache.interestPaid,
            cache.quote.baseCollateral,
            cache.quote.bonusCollateral,
            collateralSeized,
            cache.healthFactorBefore,
            cache.healthFactorAfter,
            remainingDebt
        );
    }

    function _accrueAll(address user) internal {
        _accrue(user, usdc);
        _accrue(user, eurc);
    }

    function _accrue(address user, address debtAsset) internal {
        Loan storage loan = loans[user][debtAsset];
        if (!loan.active) {
            if (loan.lastAccrualTime == 0) loan.lastAccrualTime = block.timestamp;
            return;
        }
        uint256 elapsed = block.timestamp - loan.lastAccrualTime;
        if (elapsed == 0) return;
        uint256 interest = _calculateInterest(loan.principal, borrowRatePerSecond[debtAsset], elapsed);
        loan.accruedInterest += interest;
        loan.lastAccrualTime = block.timestamp;
        totalPerformingDebt[debtAsset] += interest;
    }

    function _calculateInterest(uint256 principal, uint256 ratePerSecond, uint256 elapsed)
        internal
        pure
        returns (uint256)
    {
        if (principal == 0 || ratePerSecond == 0 || elapsed == 0) return 0;
        return Math.mulDiv(principal, ratePerSecond * elapsed, 1e18);
    }

    function _applyDebtPayment(Loan storage loan, uint256 payment)
        internal
        returns (uint256 principalPaid, uint256 interestPaid)
    {
        interestPaid = payment < loan.accruedInterest ? payment : loan.accruedInterest;
        loan.accruedInterest -= interestPaid;
        principalPaid = payment - interestPaid;
        loan.principal -= principalPaid;
        if (loan.principal == 0 && loan.accruedInterest == 0) loan.active = false;
    }

    function _recordDeficitCoverage(address asset, address contributor, uint256 amount) internal {
        protocolDeficit[asset] -= amount;
        totalBadDebtCovered[asset] += amount;
        emit ProtocolDeficitCovered(asset, contributor, amount, protocolDeficit[asset]);
        if (protocolDeficit[asset] == 0) emit DebtMarketRecovered(asset);
    }

    function _pullExact(address asset, address from, uint256 amount) internal {
        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(from, address(this), amount);
        if (IERC20(asset).balanceOf(address(this)) - balanceBefore != amount) {
            revert TokenReceiptMismatch();
        }
    }

    function _rawDebt(address user, address debtAsset) internal view returns (uint256) {
        Loan storage loan = loans[user][debtAsset];
        return loan.principal + loan.accruedInterest;
    }

    function _priceOf(PriceSnapshot memory prices, address asset) internal view returns (uint256) {
        if (asset == usdc) return prices.usdcPriceWad;
        if (asset == eurc) return prices.eurcPriceWad;
        revert UnsupportedAsset();
    }

    function _validatePositionIds(uint256[] memory positionIds) internal pure {
        if (positionIds.length == 0) revert PositionIdsEmpty();
        if (positionIds.length > MAX_POSITION_IDS) revert TooManyPositionIds();
        for (uint256 i = 1; i < positionIds.length; ++i) {
            if (positionIds[i] <= positionIds[i - 1]) revert PositionIdsNotSorted();
        }
    }

    function _readAssetUnit(address asset) internal view returns (uint256) {
        uint8 decimals = IERC20Metadata(asset).decimals();
        if (decimals > 18) revert InvalidTokenDecimals();
        return 10 ** uint256(decimals);
    }

    function _requireSupportedAsset(address asset) internal view {
        if (!supportedAssets[asset]) revert UnsupportedAsset();
    }

    function _emitRiskUpdate(bytes32 parameter, uint256 oldValue, uint256 newValue) internal {
        if (oldValue != newValue) emit RiskParameterUpdated(parameter, oldValue, newValue);
    }
}
