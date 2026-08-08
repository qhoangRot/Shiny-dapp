// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IStakingVaultV2} from "./interfaces/IStakingVaultV2.sol";

interface ILendingPoolWithdrawalValidatorV2 {
    function validateWithdrawal(address user, address asset, uint256 amount) external;
}

/// @title StakingVaultV2
/// @notice Position-based USDC/EURC staking with revenue-indexed rewards and
///         exact collateral seizure by LendingPoolV2.
contract StakingVaultV2 is IStakingVaultV2, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant REWARD_PRECISION = 1e27;
    uint256 public constant WEIGHT_PRECISION = 1e18;
    uint256 public constant MAX_POSITION_IDS = 32;
    uint256 public constant GROWTH_LOCK = 180 days;
    uint256 public constant DIAMOND_LOCK = 365 days;

    enum Tier {
        Flexible,
        Growth,
        Diamond
    }

    struct Position {
        address owner;
        address asset;
        Tier tier;
        uint256 principal;
        uint256 unlockTime;
        uint256 pendingReward;
        uint256 rewardDebt;
        bool withdrawn;
    }

    address public immutable usdc;
    address public immutable eurc;
    address public lendingPool;
    address public revenueRouter;

    uint256 public nextPositionId = 1;
    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) private _userPositionIds;
    mapping(address => uint256) public totalPrincipal;
    mapping(address => uint256) public totalWeightedPrincipal;
    mapping(address => uint256) public override accRewardPerWeightedShare;
    mapping(address => uint256) public rewardReserve;
    mapping(address => uint256) public undistributedReward;

    event Staked(
        uint256 indexed positionId,
        address indexed user,
        address indexed asset,
        Tier tier,
        uint256 amount,
        uint256 unlockTime
    );
    event RewardNotified(address indexed asset, uint256 received, uint256 distributed);
    event RewardClaimed(uint256 indexed positionId, address indexed user, uint256 amount);
    event Withdrawn(uint256 indexed positionId, address indexed user, uint256 principal, uint256 reward);
    event LendingPoolSet(address indexed lendingPool);
    event RevenueRouterSet(address indexed revenueRouter);

    error Unauthorized();
    error UnsupportedAsset();
    error DependencyAlreadySet();
    error PositionLocked();
    error NoReward();
    error TokenReceiptMismatch();
    error InsufficientRewardFunding();

    constructor(address initialOwner, address usdcAddress, address eurcAddress) Ownable(initialOwner) {
        if (initialOwner == address(0) || usdcAddress == address(0) || eurcAddress == address(0)) {
            revert ZeroAddress();
        }
        if (usdcAddress == eurcAddress) revert UnsupportedAsset();
        usdc = usdcAddress;
        eurc = eurcAddress;
    }

    modifier onlyLendingPool() {
        if (msg.sender != lendingPool) revert NotLendingPool();
        _;
    }

    modifier onlyRevenueRouter() {
        if (msg.sender != revenueRouter) revert Unauthorized();
        _;
    }

    function setLendingPool(address lendingPoolAddress) external onlyOwner {
        if (lendingPoolAddress == address(0)) revert ZeroAddress();
        if (lendingPool != address(0)) revert DependencyAlreadySet();
        lendingPool = lendingPoolAddress;
        emit LendingPoolSet(lendingPoolAddress);
    }

    function setRevenueRouter(address revenueRouterAddress) external onlyOwner {
        if (revenueRouterAddress == address(0)) revert ZeroAddress();
        if (revenueRouter != address(0)) revert DependencyAlreadySet();
        revenueRouter = revenueRouterAddress;
        emit RevenueRouterSet(revenueRouterAddress);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function stake(address asset, uint256 amount, Tier tier)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 positionId)
    {
        _requireSupportedAsset(asset);
        if (amount == 0) revert ZeroAmount();

        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(asset).balanceOf(address(this)) - balanceBefore != amount) {
            revert TokenReceiptMismatch();
        }

        uint256 weight = _tierWeight(uint8(tier));
        uint256 weightedPrincipal = Math.mulDiv(amount, weight, WEIGHT_PRECISION);
        uint256 unlockTime =
            tier == Tier.Flexible ? 0 : block.timestamp + (tier == Tier.Growth ? GROWTH_LOCK : DIAMOND_LOCK);

        positionId = nextPositionId++;
        positions[positionId] = Position({
            owner: msg.sender,
            asset: asset,
            tier: tier,
            principal: amount,
            unlockTime: unlockTime,
            pendingReward: 0,
            rewardDebt: Math.mulDiv(weightedPrincipal, accRewardPerWeightedShare[asset], REWARD_PRECISION),
            withdrawn: false
        });
        _userPositionIds[msg.sender].push(positionId);
        totalPrincipal[asset] += amount;
        totalWeightedPrincipal[asset] += weightedPrincipal;

        emit Staked(positionId, msg.sender, asset, tier, amount, unlockTime);
    }

    /// @notice Accounts reward tokens transferred to this contract by RevenueRouter.
    /// @dev If the pool was empty, rewards remain undistributed. The first staker present
    ///      immediately before the next notification participates in all of that backlog.
    ///      This is accepted behavior because no account was eligible while the pool was empty.
    function notifyReward(address asset, uint256 amount) external onlyRevenueRouter nonReentrant {
        _requireSupportedAsset(asset);
        if (amount == 0) revert ZeroAmount();

        uint256 accountedBefore = totalPrincipal[asset] + rewardReserve[asset];
        if (IERC20(asset).balanceOf(address(this)) < accountedBefore + amount) {
            revert InsufficientRewardFunding();
        }

        rewardReserve[asset] += amount;
        uint256 totalWeight = totalWeightedPrincipal[asset];
        if (totalWeight == 0) {
            undistributedReward[asset] += amount;
            emit RewardNotified(asset, amount, 0);
            return;
        }

        uint256 distributable = amount + undistributedReward[asset];
        undistributedReward[asset] = 0;
        accRewardPerWeightedShare[asset] += Math.mulDiv(distributable, REWARD_PRECISION, totalWeight);
        emit RewardNotified(asset, amount, distributable);
    }

    function claimReward(uint256 positionId) external nonReentrant returns (uint256 reward) {
        Position storage position = _position(positionId);
        if (position.owner != msg.sender) revert PositionNotOwnedByUser();
        _checkpoint(position);

        reward = position.pendingReward;
        if (reward == 0) revert NoReward();
        position.pendingReward = 0;
        rewardReserve[position.asset] -= reward;
        if (position.principal == 0) position.withdrawn = true;

        IERC20(position.asset).safeTransfer(msg.sender, reward);
        emit RewardClaimed(positionId, msg.sender, reward);
    }

    function withdraw(uint256 positionId) external nonReentrant returns (uint256 principal, uint256 reward) {
        Position storage position = _position(positionId);
        if (position.owner != msg.sender) revert PositionNotOwnedByUser();
        if (position.withdrawn) revert PositionAlreadyWithdrawn();
        // Lock expiry necessarily uses chain time; small validator drift cannot bypass
        // LendingPoolV2.validateWithdrawal or transfer more than this position owns.
        // forge-lint: disable-next-line(block-timestamp)
        if (position.unlockTime != 0 && block.timestamp < position.unlockTime) revert PositionLocked();

        _checkpoint(position);
        principal = position.principal;
        reward = position.pendingReward;
        if (principal == 0) revert ZeroAmount();

        if (lendingPool != address(0)) {
            ILendingPoolWithdrawalValidatorV2(lendingPool).validateWithdrawal(msg.sender, position.asset, principal);
        }

        uint256 weightedPrincipal = _weightedPrincipal(position.principal, position.tier);
        totalPrincipal[position.asset] -= principal;
        totalWeightedPrincipal[position.asset] -= weightedPrincipal;
        if (reward != 0) rewardReserve[position.asset] -= reward;
        position.principal = 0;
        position.pendingReward = 0;
        position.rewardDebt = 0;
        position.withdrawn = true;

        IERC20(position.asset).safeTransfer(msg.sender, principal + reward);
        emit Withdrawn(positionId, msg.sender, principal, reward);
    }

    function pendingReward(uint256 positionId) external view returns (uint256) {
        Position storage position = positions[positionId];
        if (position.owner == address(0)) return 0;
        uint256 accumulated = Math.mulDiv(
            _weightedPrincipal(position.principal, position.tier),
            accRewardPerWeightedShare[position.asset],
            REWARD_PRECISION
        );
        uint256 newlyEarned = accumulated > position.rewardDebt ? accumulated - position.rewardDebt : 0;
        return position.pendingReward + newlyEarned;
    }

    function userPositionIds(address user) external view returns (uint256[] memory) {
        return _userPositionIds[user];
    }

    function getSeizablePrincipal(address user, address asset, uint256[] calldata positionIds)
        external
        view
        override
        returns (uint256 total)
    {
        _validatePositionIds(positionIds);
        for (uint256 i; i < positionIds.length; ++i) {
            Position storage position = _position(positionIds[i]);
            _validateSeizablePosition(position, user, asset);
            total += position.principal;
        }
    }

    function getTotalSeizablePrincipal(address user, address asset) external view override returns (uint256 total) {
        uint256[] storage ids = _userPositionIds[user];
        for (uint256 i; i < ids.length; ++i) {
            Position storage position = positions[ids[i]];
            if (position.asset == asset && !position.withdrawn) total += position.principal;
        }
    }

    function seizeStakedCollateral(
        address user,
        address asset,
        uint256[] calldata positionIds,
        uint256 amount,
        address recipient
    ) external override onlyLendingPool nonReentrant returns (uint256 amountSeized) {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        _validatePositionIds(positionIds);

        uint256 selectedPrincipal;
        for (uint256 i; i < positionIds.length; ++i) {
            Position storage position = _position(positionIds[i]);
            _validateSeizablePosition(position, user, asset);
            selectedPrincipal += position.principal;
        }
        if (selectedPrincipal < amount) revert InsufficientSelectedPrincipal();

        uint256 remaining = amount;
        uint256[] memory seizedAmounts = new uint256[](positionIds.length);
        uint256 affectedCount;
        for (uint256 i; i < positionIds.length && remaining != 0; ++i) {
            uint256 seizedFromPosition = _seizeFromPosition(positionIds[i], asset, remaining);
            seizedAmounts[i] = seizedFromPosition;
            affectedCount = i + 1;
            remaining -= seizedFromPosition;
        }

        if (remaining != 0) revert InsufficientSelectedPrincipal();
        IERC20(asset).safeTransfer(recipient, amount);
        _emitSeizeEvents(positionIds, seizedAmounts, affectedCount, user, asset);
        amountSeized = amount;
    }

    function _emitSeizeEvents(
        uint256[] calldata positionIds,
        uint256[] memory seizedAmounts,
        uint256 affectedCount,
        address user,
        address asset
    ) internal {
        for (uint256 i; i < affectedCount; ++i) {
            uint256 positionId = positionIds[i];
            emit PositionCollateralSeized(positionId, user, asset, seizedAmounts[i], positions[positionId].principal);
        }
    }

    function _seizeFromPosition(uint256 positionId, address asset, uint256 remaining)
        internal
        returns (uint256 seizedFromPosition)
    {
        Position storage position = positions[positionId];
        _checkpoint(position);

        seizedFromPosition = position.principal < remaining ? position.principal : remaining;
        uint256 oldWeighted = _weightedPrincipal(position.principal, position.tier);
        position.principal -= seizedFromPosition;
        uint256 newWeighted = _weightedPrincipal(position.principal, position.tier);
        totalPrincipal[asset] -= seizedFromPosition;
        totalWeightedPrincipal[asset] -= oldWeighted - newWeighted;
        position.rewardDebt = Math.mulDiv(newWeighted, accRewardPerWeightedShare[asset], REWARD_PRECISION);
    }

    function tierWeight(uint8 tier) external pure override returns (uint256) {
        return _tierWeight(tier);
    }

    function _checkpoint(Position storage position) internal {
        uint256 weighted = _weightedPrincipal(position.principal, position.tier);
        uint256 accumulated = Math.mulDiv(weighted, accRewardPerWeightedShare[position.asset], REWARD_PRECISION);
        if (accumulated > position.rewardDebt) {
            position.pendingReward += accumulated - position.rewardDebt;
        }
        position.rewardDebt = accumulated;
    }

    function _validatePositionIds(uint256[] calldata positionIds) internal pure {
        if (positionIds.length == 0) revert PositionIdsEmpty();
        if (positionIds.length > MAX_POSITION_IDS) revert TooManyPositionIds();
        for (uint256 i = 1; i < positionIds.length; ++i) {
            if (positionIds[i] <= positionIds[i - 1]) revert PositionIdsNotSorted();
        }
    }

    function _validateSeizablePosition(Position storage position, address user, address asset) internal view {
        if (position.owner != user) revert PositionNotOwnedByUser();
        if (position.asset != asset) revert PositionAssetMismatch();
        if (position.withdrawn || position.principal == 0) revert PositionAlreadyWithdrawn();
    }

    function _position(uint256 positionId) internal view returns (Position storage position) {
        position = positions[positionId];
        if (position.owner == address(0)) revert PositionNotFound();
    }

    function _weightedPrincipal(uint256 principal, Tier tier) internal pure returns (uint256) {
        return Math.mulDiv(principal, _tierWeight(uint8(tier)), WEIGHT_PRECISION);
    }

    function _tierWeight(uint8 tier) internal pure returns (uint256) {
        if (tier == uint8(Tier.Flexible)) return 1e18;
        if (tier == uint8(Tier.Growth)) return 1.2e18;
        if (tier == uint8(Tier.Diamond)) return 1.4e18;
        revert InvalidTier();
    }

    function _requireSupportedAsset(address asset) internal view {
        if (asset != usdc && asset != eurc) revert UnsupportedAsset();
    }
}
