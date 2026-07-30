// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Read-only interface for the currently deployed Shiny StakingVault.
/// @dev The getter signature matches the public `positions` mapping in
///      StakingVault. RewardDistributor never transfers tokens out of the vault.
interface IShinyStakingVault {
    function supportedAssets(address asset) external view returns (bool);

    function positions(uint256 positionId)
        external
        view
        returns (
            address positionOwner,
            address asset,
            uint8 tier,
            uint256 principal,
            uint256 startTime,
            uint256 unlockTime,
            uint256 lastAccrualTime,
            uint256 accruedReward,
            bool withdrawn
        );
}

/// @title RewardDistributor - funded reward sidecar for Shiny
/// @notice Pays same-asset staking rewards without ever taking custody of vault
///         principal. Rewards are defined by immutable, non-overlapping programs.
/// @dev Annual rates use basis points: 500 = 5.00% APR. A position accrues from
///      max(program.startTime, position.startTime), so creating a new program
///      never grants rewards for time before that program started.
contract RewardDistributor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint32 public constant MAX_ANNUAL_BPS = 10_000;
    uint256 public constant MAX_PROGRAMS_PER_ASSET = 64;

    struct RewardProgram {
        address asset;
        uint64 startTime;
        uint64 endTime;
        uint32 flexibleAnnualBps;
        uint32 growthAnnualBps;
        uint32 diamondAnnualBps;
        uint256 funded;
        uint256 claimed;
    }

    struct PositionSnapshot {
        address owner;
        address asset;
        uint8 tier;
        uint256 principal;
        uint256 startTime;
        bool withdrawn;
    }

    IShinyStakingVault public immutable stakingVault;
    uint256 public nextProgramId = 1;

    mapping(uint256 => RewardProgram) public programs;
    mapping(address => uint256) public latestProgramId;
    mapping(address => uint256) public reservedByAsset;
    mapping(uint256 => mapping(uint256 => uint256)) public claimedByPosition;
    mapping(address => uint256[]) private _assetProgramIds;

    error ZeroAddress();
    error UnsupportedAsset(address asset);
    error InvalidProgramWindow(uint256 startTime, uint256 endTime);
    error ProgramStartsInPast(uint256 startTime, uint256 currentTime);
    error ProgramOverlap(address asset, uint256 previousEndTime, uint256 requestedStartTime);
    error AnnualBpsTooHigh(uint256 annualBps);
    error AllRatesAreZero();
    error InvalidTierRateOrder(uint256 flexibleAnnualBps, uint256 growthAnnualBps, uint256 diamondAnnualBps);
    error TooManyPrograms(address asset, uint256 maximum);
    error ProgramNotFound(uint256 programId);
    error ZeroAmount();
    error NoTokensReceived();
    error PositionNotFound(uint256 positionId);
    error NotPositionOwner(uint256 positionId, address caller);
    error PositionInactive(uint256 positionId);
    error PositionAssetMismatch(uint256 positionId, address expectedAsset, address actualAsset);
    error InvalidPositionTier(uint256 positionId, uint8 tier);
    error NothingToClaim(uint256 programId, uint256 positionId);
    error NoRewardsToClaim(uint256 positionId);
    error InsufficientProgramReserve(uint256 programId, uint256 available, uint256 required);

    event ProgramCreated(
        uint256 indexed programId,
        address indexed asset,
        uint64 startTime,
        uint64 endTime,
        uint32 flexibleAnnualBps,
        uint32 growthAnnualBps,
        uint32 diamondAnnualBps
    );
    event ProgramFunded(uint256 indexed programId, address indexed funder, address indexed asset, uint256 amount);
    event ProgramRewardClaimed(
        uint256 indexed programId, uint256 indexed positionId, address indexed account, address asset, uint256 amount
    );
    event RewardClaimed(
        uint256 indexed positionId, address indexed account, address indexed asset, uint256 amount, uint256 programCount
    );

    constructor(address initialOwner, address stakingVaultAddress) Ownable(initialOwner) {
        if (stakingVaultAddress == address(0)) revert ZeroAddress();
        stakingVault = IShinyStakingVault(stakingVaultAddress);
    }

    /// @notice Creates an immutable reward epoch for one asset.
    /// @dev Programs for the same asset must be created chronologically and may
    ///      touch at their boundary, but can never overlap.
    function createProgram(
        address asset,
        uint64 startTime,
        uint64 endTime,
        uint32 flexibleAnnualBps,
        uint32 growthAnnualBps,
        uint32 diamondAnnualBps
    ) external onlyOwner returns (uint256 programId) {
        if (asset == address(0)) revert ZeroAddress();
        if (!stakingVault.supportedAssets(asset)) revert UnsupportedAsset(asset);
        if (endTime <= startTime) revert InvalidProgramWindow(startTime, endTime);
        if (startTime < block.timestamp) revert ProgramStartsInPast(startTime, block.timestamp);

        _validateAnnualBps(flexibleAnnualBps);
        _validateAnnualBps(growthAnnualBps);
        _validateAnnualBps(diamondAnnualBps);
        if (flexibleAnnualBps == 0 && growthAnnualBps == 0 && diamondAnnualBps == 0) {
            revert AllRatesAreZero();
        }
        if (flexibleAnnualBps > growthAnnualBps || growthAnnualBps > diamondAnnualBps) {
            revert InvalidTierRateOrder(flexibleAnnualBps, growthAnnualBps, diamondAnnualBps);
        }
        if (_assetProgramIds[asset].length >= MAX_PROGRAMS_PER_ASSET) {
            revert TooManyPrograms(asset, MAX_PROGRAMS_PER_ASSET);
        }

        uint256 previousProgramId = latestProgramId[asset];
        if (previousProgramId != 0) {
            uint64 previousEndTime = programs[previousProgramId].endTime;
            if (startTime < previousEndTime) {
                revert ProgramOverlap(asset, previousEndTime, startTime);
            }
        }

        programId = nextProgramId++;
        programs[programId] = RewardProgram({
            asset: asset,
            startTime: startTime,
            endTime: endTime,
            flexibleAnnualBps: flexibleAnnualBps,
            growthAnnualBps: growthAnnualBps,
            diamondAnnualBps: diamondAnnualBps,
            funded: 0,
            claimed: 0
        });
        latestProgramId[asset] = programId;
        _assetProgramIds[asset].push(programId);

        emit ProgramCreated(programId, asset, startTime, endTime, flexibleAnnualBps, growthAnnualBps, diamondAnnualBps);
    }

    /// @notice Adds a physically transferred, same-asset reserve to a program.
    /// @dev Anyone may sponsor a program. Accounting credits the actual balance
    ///      received, which also handles tokens that charge transfer fees.
    function fundProgram(uint256 programId, uint256 amount) external nonReentrant returns (uint256 received) {
        RewardProgram storage program = _requireProgram(programId);
        if (amount == 0) revert ZeroAmount();

        IERC20 token = IERC20(program.asset);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        received = token.balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert NoTokensReceived();

        program.funded += received;
        reservedByAsset[program.asset] += received;

        emit ProgramFunded(programId, msg.sender, program.asset, received);
    }

    /// @notice Claims reward from one explicit program.
    /// @dev Frontends should normally call claimReward(positionId), which
    ///      aggregates every relevant program and performs one token transfer.
    function claimProgramReward(uint256 programId, uint256 positionId) external nonReentrant returns (uint256 amount) {
        RewardProgram storage program = _requireProgram(programId);
        PositionSnapshot memory position = _getPosition(positionId);
        _validatePositionForClaim(positionId, position, msg.sender);
        if (position.asset != program.asset) {
            revert PositionAssetMismatch(positionId, program.asset, position.asset);
        }

        uint256 totalEarned =
            _calculateEarned(program, positionId, position.tier, position.principal, position.startTime);
        uint256 alreadyClaimed = claimedByPosition[programId][positionId];
        if (totalEarned <= alreadyClaimed) revert NothingToClaim(programId, positionId);
        amount = totalEarned - alreadyClaimed;

        uint256 available = program.funded - program.claimed;
        if (amount > available) {
            revert InsufficientProgramReserve(programId, available, amount);
        }

        claimedByPosition[programId][positionId] = totalEarned;
        program.claimed += amount;
        reservedByAsset[program.asset] -= amount;

        IERC20(program.asset).safeTransfer(msg.sender, amount);
        emit ProgramRewardClaimed(programId, positionId, msg.sender, program.asset, amount);
    }

    /// @notice Claims all accrued programs for one position with one transfer.
    /// @dev Every affected program is checked for sufficient reserve before any
    ///      state is changed. One underfunded program therefore reverts atomically.
    function claimReward(uint256 positionId) external nonReentrant {
        PositionSnapshot memory position = _getPosition(positionId);
        _validatePositionForClaim(positionId, position, msg.sender);

        uint256[] storage programIds = _assetProgramIds[position.asset];
        uint256 length = programIds.length;
        uint256[] memory earnedTotals = new uint256[](length);
        uint256[] memory dueAmounts = new uint256[](length);
        uint256 amount;
        uint256 programsClaimed;

        // Check every reserve first. No accounting is changed in this pass.
        for (uint256 index = 0; index < length; index++) {
            uint256 programId = programIds[index];
            RewardProgram storage program = programs[programId];
            uint256 totalEarned =
                _calculateEarned(program, positionId, position.tier, position.principal, position.startTime);
            uint256 alreadyClaimed = claimedByPosition[programId][positionId];
            if (totalEarned <= alreadyClaimed) continue;

            uint256 due = totalEarned - alreadyClaimed;
            uint256 available = program.funded - program.claimed;
            if (due > available) {
                revert InsufficientProgramReserve(programId, available, due);
            }

            earnedTotals[index] = totalEarned;
            dueAmounts[index] = due;
            amount += due;
            programsClaimed++;
        }

        if (amount == 0) revert NoRewardsToClaim(positionId);

        // Effects for all programs are committed before the single interaction.
        for (uint256 index = 0; index < length; index++) {
            uint256 due = dueAmounts[index];
            if (due == 0) continue;

            uint256 programId = programIds[index];
            claimedByPosition[programId][positionId] = earnedTotals[index];
            programs[programId].claimed += due;
        }
        reservedByAsset[position.asset] -= amount;

        IERC20(position.asset).safeTransfer(msg.sender, amount);
        emit RewardClaimed(positionId, msg.sender, position.asset, amount, programsClaimed);
    }

    /// @notice Returns reward from one explicit program.
    function pendingRewardForProgram(uint256 programId, uint256 positionId) public view returns (uint256) {
        RewardProgram storage program = programs[programId];
        if (program.asset == address(0)) return 0;

        PositionSnapshot memory position = _getPosition(positionId);
        if (
            position.owner == address(0) || position.withdrawn || position.principal == 0
                || position.asset != program.asset || position.tier > 2
        ) {
            return 0;
        }

        uint256 totalEarned =
            _calculateEarned(program, positionId, position.tier, position.principal, position.startTime);
        uint256 alreadyClaimed = claimedByPosition[programId][positionId];
        return totalEarned > alreadyClaimed ? totalEarned - alreadyClaimed : 0;
    }

    /// @notice Aggregate claimable reward across every program for a position.
    /// @dev This is the frontend-compatible getter; no programId is required.
    function pendingReward(uint256 positionId) external view returns (uint256 amount) {
        PositionSnapshot memory position = _getPosition(positionId);
        if (position.owner == address(0) || position.withdrawn || position.principal == 0 || position.tier > 2) {
            return 0;
        }

        uint256[] storage programIds = _assetProgramIds[position.asset];
        for (uint256 index = 0; index < programIds.length; index++) {
            uint256 programId = programIds[index];
            RewardProgram storage program = programs[programId];
            uint256 totalEarned =
                _calculateEarned(program, positionId, position.tier, position.principal, position.startTime);
            uint256 alreadyClaimed = claimedByPosition[programId][positionId];
            if (totalEarned > alreadyClaimed) amount += totalEarned - alreadyClaimed;
        }
    }

    /// @notice Annual BPS for the program active at the current timestamp.
    /// @dev Searches backwards so a future scheduled program does not hide the
    ///      currently active one.
    function currentAnnualRateBps(address asset, uint8 tier) external view returns (uint256) {
        uint256[] storage programIds = _assetProgramIds[asset];
        for (uint256 index = programIds.length; index > 0; index--) {
            RewardProgram storage program = programs[programIds[index - 1]];
            if (block.timestamp >= program.startTime && block.timestamp < program.endTime) {
                return _annualBpsForTier(program, 0, tier);
            }
        }
        if (tier > 2) revert InvalidPositionTier(0, tier);
        return 0;
    }

    function annualBpsForTier(uint256 programId, uint8 tier) external view returns (uint32) {
        RewardProgram storage program = _requireProgram(programId);
        return _annualBpsForTier(program, 0, tier);
    }

    function programAvailableReserve(uint256 programId) external view returns (uint256) {
        RewardProgram storage program = _requireProgram(programId);
        return program.funded - program.claimed;
    }

    function assetProgramCount(address asset) external view returns (uint256) {
        return _assetProgramIds[asset].length;
    }

    function assetProgramIdAt(address asset, uint256 index) external view returns (uint256) {
        return _assetProgramIds[asset][index];
    }

    function assetProgramIds(address asset) external view returns (uint256[] memory) {
        return _assetProgramIds[asset];
    }

    function _getPosition(uint256 positionId) internal view returns (PositionSnapshot memory position) {
        (position.owner, position.asset, position.tier, position.principal, position.startTime,,,, position.withdrawn) =
            stakingVault.positions(positionId);
    }

    function _validatePositionForClaim(uint256 positionId, PositionSnapshot memory position, address caller)
        internal
        pure
    {
        if (position.owner == address(0)) revert PositionNotFound(positionId);
        if (position.owner != caller) revert NotPositionOwner(positionId, caller);
        if (position.withdrawn || position.principal == 0) revert PositionInactive(positionId);
        if (position.tier > 2) revert InvalidPositionTier(positionId, position.tier);
    }

    function _calculateEarned(
        RewardProgram storage program,
        uint256 positionId,
        uint8 tier,
        uint256 principal,
        uint256 positionStartTime
    ) internal view returns (uint256) {
        uint256 accrualStart = positionStartTime > program.startTime ? positionStartTime : program.startTime;
        uint256 accrualEnd = block.timestamp < program.endTime ? block.timestamp : program.endTime;
        if (accrualEnd <= accrualStart) return 0;

        uint256 annualBps = _annualBpsForTier(program, positionId, tier);
        uint256 elapsed = accrualEnd - accrualStart;
        return Math.mulDiv(principal, annualBps * elapsed, BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    function _annualBpsForTier(RewardProgram storage program, uint256 positionId, uint8 tier)
        internal
        view
        returns (uint32)
    {
        if (tier == 0) return program.flexibleAnnualBps;
        if (tier == 1) return program.growthAnnualBps;
        if (tier == 2) return program.diamondAnnualBps;
        revert InvalidPositionTier(positionId, tier);
    }

    function _validateAnnualBps(uint32 annualBps) internal pure {
        if (annualBps > MAX_ANNUAL_BPS) revert AnnualBpsTooHigh(annualBps);
    }

    function _requireProgram(uint256 programId) internal view returns (RewardProgram storage program) {
        program = programs[programId];
        if (program.asset == address(0)) revert ProgramNotFound(programId);
    }
}
