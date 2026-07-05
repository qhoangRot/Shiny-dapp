// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Interface toi thieu de StakingVault goi nguoc sang LendingPool kiem tra Health Factor
interface ILendingPoolView {
    function checkWithdrawSafety(address user, address asset, uint256 amountBeingWithdrawn) external;
}

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title StakingVault - Shiny Protocol
/// @notice Quan ly stake USDC/EURC theo 3 vault tier (Flexible/Growth/Diamond),
///         tinh reward theo thoi gian va ap dung bang phat rut som co dinh theo bac thang.
contract StakingVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

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
        uint256 startTime;
        uint256 unlockTime; // 0 neu la Flexible (khong khoa)
        uint256 lastAccrualTime;
        uint256 accruedReward;
        bool withdrawn;
    }

    uint256 public constant GROWTH_LOCK = 180 days;
    uint256 public constant DIAMOND_LOCK = 365 days;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    mapping(address => bool) public supportedAssets;
    // Lai suat reward moi giay, scale 1e18, tinh tren moi don vi token goc.
    // Day la gia tri tam thoi do admin set thu cong o giai doan MVP,
    // se duoc thay bang lai suat thuc te tu Lending Pool o phase sau.
    mapping(address => uint256) public rewardRatePerSecond;
    mapping(Tier => uint256) public tierBoostBps; // Growth/Diamond duoc cong them APY boost

    mapping(uint256 => Position) public positions;
    uint256 public nextPositionId = 1;

    // QUAN TRONG: Quy bao hiem duoc tach rieng theo TUNG ASSET.
    // KHONG duoc gop USDC va EURC vao chung 1 bien, vi 1 USDC != 1 EURC ve gia tri.
    mapping(address => uint256) public pendingInsuranceFund;

    // Dia chi LendingPool, dung de kiem tra Health Factor truoc khi cho emergencyWithdraw
    // (chi ap dung neu user co dang vay tai LendingPool)
    address public lendingPool;

    event Staked(
        uint256 indexed positionId, address indexed user, address asset, Tier tier, uint256 amount, uint256 unlockTime
    );
    event Withdrawn(uint256 indexed positionId, uint256 principal, uint256 reward);
    event EmergencyWithdrawn(
        uint256 indexed positionId, uint256 principal, uint256 rewardPaid, uint256 rewardForfeited
    );
    event RewardClaimed(uint256 indexed positionId, uint256 amount);
    event AssetSupported(address indexed asset, bool status);
    event RewardRateUpdated(address indexed asset, uint256 newRate);
    event InsuranceFundSwept(address indexed asset, address indexed to, uint256 amount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ---------------------------------------------------------------------
    // ADMIN
    // ---------------------------------------------------------------------

    function setSupportedAsset(address asset, bool status) external onlyOwner {
        supportedAssets[asset] = status;
        emit AssetSupported(asset, status);
    }

    function setRewardRatePerSecond(address asset, uint256 rate) external onlyOwner {
        rewardRatePerSecond[asset] = rate;
        emit RewardRateUpdated(asset, rate);
    }

    function setTierBoostBps(Tier tier, uint256 boostBps) external onlyOwner {
        tierBoostBps[tier] = boostBps;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setLendingPool(address lendingPoolAddress) external onlyOwner {
        lendingPool = lendingPoolAddress;
    }

    /// @notice Tong so tien mot user dang stake (tat ca position con active) cho 1 loai asset.
    ///         LendingPool goi ham nay de tinh tai san the chap ma KHONG can user rut tien ra.
    function getTotalStakedByUser(address user, address asset) external view returns (uint256 total) {
        for (uint256 i = 1; i < nextPositionId; i++) {
            Position storage p = positions[i];
            if (p.owner == user && p.asset == asset && !p.withdrawn) {
                total += p.principal;
            }
        }
    }

    /// @notice Chuyen quy bao hiem da tich luy sang contract InsuranceFund that (phase 2)
    function sweepInsuranceFund(address asset, address to) external onlyOwner {
        uint256 amount = pendingInsuranceFund[asset];
        require(amount > 0, "Khong co gi de chuyen");
        pendingInsuranceFund[asset] = 0;
        IERC20(asset).safeTransfer(to, amount);
        emit InsuranceFundSwept(asset, to, amount);
    }

    // ---------------------------------------------------------------------
    // STAKE
    // ---------------------------------------------------------------------

    function stake(address asset, uint256 amount, Tier tier)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 positionId)
    {
        require(supportedAssets[asset], "Asset khong duoc ho tro");
        require(amount > 0, "So luong phai > 0");

        uint256 lockDuration = _lockDurationOf(tier);
        uint256 unlockTime = lockDuration == 0 ? 0 : block.timestamp + lockDuration;

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        positionId = nextPositionId++;
        positions[positionId] = Position({
            owner: msg.sender,
            asset: asset,
            tier: tier,
            principal: amount,
            startTime: block.timestamp,
            unlockTime: unlockTime,
            lastAccrualTime: block.timestamp,
            accruedReward: 0,
            withdrawn: false
        });

        emit Staked(positionId, msg.sender, asset, tier, amount, unlockTime);
    }

    function _lockDurationOf(Tier tier) internal pure returns (uint256) {
        if (tier == Tier.Growth) return GROWTH_LOCK;
        if (tier == Tier.Diamond) return DIAMOND_LOCK;
        return 0; // Flexible
    }

    // ---------------------------------------------------------------------
    // REWARD ACCRUAL
    // ---------------------------------------------------------------------

    function _accrue(uint256 positionId) internal {
        Position storage p = positions[positionId];
        if (p.withdrawn) return;

        uint256 elapsed = block.timestamp - p.lastAccrualTime;
        if (elapsed == 0) return;

        p.accruedReward += _calcReward(p, elapsed);
        p.lastAccrualTime = block.timestamp;
    }

    function _calcReward(Position storage p, uint256 elapsed) internal view returns (uint256) {
        uint256 baseRate = rewardRatePerSecond[p.asset];
        uint256 boostBps = tierBoostBps[p.tier];
        uint256 effectiveRate = baseRate + (baseRate * boostBps / BPS_DENOMINATOR);
        return (p.principal * effectiveRate * elapsed) / 1e18;
    }

    /// @notice Xem truoc reward hien tai (khong ton gas, dung cho UI)
    function pendingReward(uint256 positionId) public view returns (uint256) {
        Position storage p = positions[positionId];
        if (p.withdrawn) return 0;
        uint256 elapsed = block.timestamp - p.lastAccrualTime;
        return p.accruedReward + _calcReward(p, elapsed);
    }

    function claimReward(uint256 positionId) external nonReentrant {
        Position storage p = positions[positionId];
        require(p.owner == msg.sender, "Khong phai chu position");
        require(!p.withdrawn, "Position da dong");

        _accrue(positionId);
        uint256 reward = p.accruedReward;
        require(reward > 0, "Khong co reward de claim");
        p.accruedReward = 0;

        IERC20(p.asset).safeTransfer(msg.sender, reward);
        emit RewardClaimed(positionId, reward);
    }

    // ---------------------------------------------------------------------
    // WITHDRAW (dung han khoa)
    // ---------------------------------------------------------------------

    function withdraw(uint256 positionId) external nonReentrant {
        Position storage p = positions[positionId];
        require(p.owner == msg.sender, "Khong phai chu position");
        require(!p.withdrawn, "Position da dong");
        require(block.timestamp >= p.unlockTime, "Chua den han khoa, dung emergencyWithdraw");

        _accrue(positionId);
        uint256 principal = p.principal;
        uint256 reward = p.accruedReward;

        p.withdrawn = true;
        p.principal = 0;
        p.accruedReward = 0;

        IERC20(p.asset).safeTransfer(msg.sender, principal + reward);
        emit Withdrawn(positionId, principal, reward);
    }

    // ---------------------------------------------------------------------
    // EMERGENCY WITHDRAW — BANG PHAT BAC THANG CO DINH (khong phai linear decay)
    // ---------------------------------------------------------------------

    /// @dev Bang phat theo spec muc 3.3:
    ///      0-3 thang: 100% | 3-6 thang: 75% | 6-9 thang: 50% | 9-12 thang: 25% | 12+ thang: 0%
    ///      Tinh theo TON TAI CUA POSITION (startTime), khong phai theo tier lock duration.
    function _penaltyBpsForTimeHeld(uint256 timeHeld) internal pure returns (uint256) {
        if (timeHeld < 90 days) return 10_000; // 100%
        if (timeHeld < 180 days) return 7_500; // 75%
        if (timeHeld < 270 days) return 5_000; // 50%
        if (timeHeld < 365 days) return 2_500; // 25%
        return 0; // 0%
    }

    /// @notice Rut som bat cu luc nao. Von goc LUON duoc tra 100%.
    ///         Chi phat vao phan reward chua claim, theo bang bac thang co dinh.
    ///         Phan reward bi phat se chuyen vao pendingInsuranceFund cua DUNG asset do.
    function emergencyWithdraw(uint256 positionId) external nonReentrant {
        Position storage p = positions[positionId];
        require(p.owner == msg.sender, "Khong phai chu position");
        require(!p.withdrawn, "Position da dong");

        _accrue(positionId);

        uint256 principal = p.principal;
        uint256 reward = p.accruedReward;
        uint256 timeHeld = block.timestamp - p.startTime;
        uint256 penaltyBps = _penaltyBpsForTimeHeld(timeHeld);

        uint256 rewardForfeited = (reward * penaltyBps) / BPS_DENOMINATOR;
        uint256 rewardToUser = reward - rewardForfeited;

        p.withdrawn = true;
        p.principal = 0;
        p.accruedReward = 0;

        if (rewardForfeited > 0) {
            pendingInsuranceFund[p.asset] += rewardForfeited;
        }

        // Neu user co dang vay tai LendingPool, kiem tra Health Factor sau khi rut
        // van phai an toan (>= 1.0), neu khong thi tu choi rut (dung theo spec muc 3.3)
        if (lendingPool != address(0)) {
            ILendingPoolView(lendingPool).checkWithdrawSafety(msg.sender, p.asset, principal);
        }

        IERC20(p.asset).safeTransfer(msg.sender, principal + rewardToUser);
        emit EmergencyWithdrawn(positionId, principal, rewardToUser, rewardForfeited);
    }
}
