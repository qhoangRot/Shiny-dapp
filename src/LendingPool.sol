// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./oracle/PriceOracle.sol";

/// @title LendingPool - Shiny Protocol
/// @notice Cho vay/muon cheo tai san (USDC <-> EURC), tinh Health Factor theo portfolio,
///         lai suat tich luy lien tuc, thanh ly cong khai (ai cung goi duoc).
/// @dev Phien ban MVP: collateral duoc deposit rieng (chua noi truc tiep voi StakingVault).

/// @notice Interface toi thieu de LendingPool doc du lieu tu StakingVault
interface IStakingVaultView {
    function getTotalStakedByUser(address user, address asset) external view returns (uint256);
}

contract LendingPool is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // CONFIG
    // ---------------------------------------------------------------------

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant HF_PRECISION = 1e18;

    uint256 public maxLtvBps = 7_500; // 75% - LTV toi da khi vay moi
    uint256 public liquidationThresholdBps = 8_330; // 83.3% - nguong bi thanh ly
    uint256 public liquidationBonusBps = 500; // 5% - thuong cho nguoi thanh ly

    // Lai suat vay, moi giay, scale 1e18 (admin dieu chinh theo utilization o phase sau)
    mapping(address => uint256) public borrowRatePerSecond;

    address public usdc;
    address public eurc;
    PriceOracle public oracle; // Gia EURC/USD, dung de quy doi cheo USDC<->EURC
    IStakingVaultView public stakingVault; // Doc so du dang stake, khong can user rut ra

    mapping(address => bool) public supportedAssets;

    // ---------------------------------------------------------------------
    // STATE - Portfolio theo tung user
    // ---------------------------------------------------------------------

    // So luong tai san the chap user da gui vao, theo tung loai asset
    mapping(address => mapping(address => uint256)) public collateralBalance; // user => asset => amount

    // Mon vay: 1 user co the co toi da 1 mon vay dang mo cho MOI loai asset di vay
    struct Loan {
        uint256 principal;
        uint256 lastAccrualTime;
        uint256 accruedInterest;
        bool active;
    }
    mapping(address => mapping(address => Loan)) public loans; // user => borrowedAsset => Loan

    event CollateralDeposited(address indexed user, address indexed asset, uint256 amount);
    event CollateralWithdrawn(address indexed user, address indexed asset, uint256 amount);
    event Borrowed(address indexed user, address indexed asset, uint256 amount);
    event Repaid(address indexed user, address indexed asset, uint256 amount);
    event Liquidated(
        address indexed user,
        address indexed liquidator,
        address indexed debtAsset,
        uint256 debtRepaid,
        uint256 collateralSeized
    );

    constructor(address initialOwner, address usdcAddress, address eurcAddress, address oracleAddress)
        Ownable(initialOwner)
    {
        usdc = usdcAddress;
        eurc = eurcAddress;
        oracle = PriceOracle(oracleAddress);
        supportedAssets[usdcAddress] = true;
        supportedAssets[eurcAddress] = true;
    }

    function setStakingVault(address stakingVaultAddress) external onlyOwner {
        stakingVault = IStakingVaultView(stakingVaultAddress);
    }

    /// @notice StakingVault goi ham nay TRUOC khi cho user emergencyWithdraw,
    ///         de dam bao rut xong Health Factor van an toan (>= 1.0).
    ///         Neu khong an toan, ham nay se revert, chan luon giao dich rut ben StakingVault.
    function checkWithdrawSafety(address user, address asset, uint256 amountBeingWithdrawn) external {
        uint256 debt = _totalDebtValueInUsdc(user);
        if (debt == 0) return; // Khong vay gi ca, rut thoai mai

        uint256 collateral = _totalCollateralValueInUsdc(user);
        uint256 amountValueInUsdc = asset == eurc ? _convert(eurc, usdc, amountBeingWithdrawn) : amountBeingWithdrawn;

        uint256 collateralAfterWithdraw = collateral > amountValueInUsdc ? collateral - amountValueInUsdc : 0;
        uint256 adjustedCollateral = (collateralAfterWithdraw * liquidationThresholdBps) / BPS_DENOMINATOR;
        uint256 hfAfter = (adjustedCollateral * HF_PRECISION) / debt;

        require(hfAfter >= HF_PRECISION, "LendingPool: rut se lam Health Factor mat an toan");
    }

    // ---------------------------------------------------------------------
    // ADMIN
    // ---------------------------------------------------------------------

    function setBorrowRatePerSecond(address asset, uint256 rate) external onlyOwner {
        borrowRatePerSecond[asset] = rate;
    }

    function setRiskParams(uint256 newMaxLtvBps, uint256 newLiqThresholdBps, uint256 newLiqBonusBps)
        external
        onlyOwner
    {
        require(newMaxLtvBps < newLiqThresholdBps, "Max LTV phai nho hon nguong thanh ly");
        maxLtvBps = newMaxLtvBps;
        liquidationThresholdBps = newLiqThresholdBps;
        liquidationBonusBps = newLiqBonusBps;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // GIA QUY DOI (thong qua PriceOracle, gia EURC/USD scale 1e18)
    // ---------------------------------------------------------------------

    /// @notice Quy doi so luong 1 asset sang gia tri tuong duong cua asset kia, dua vao gia oracle.
    ///         Gia dinh USDC luon ~1 USD (day la stablecoin goc cua Arc).
    function _convert(address fromAsset, address toAsset, uint256 amount) internal returns (uint256) {
        if (fromAsset == toAsset) return amount;
        uint256 eurcUsdPrice = oracle.getPrice(); // gia 1 EURC = ? USD, scale 1e18

        if (fromAsset == usdc && toAsset == eurc) {
            // amount USDC -> EURC = amount / gia
            return (amount * 1e18) / eurcUsdPrice;
        } else if (fromAsset == eurc && toAsset == usdc) {
            // amount EURC -> USDC = amount * gia
            return (amount * eurcUsdPrice) / 1e18;
        }
        revert("Cap tai san khong duoc ho tro quy doi");
    }

    // ---------------------------------------------------------------------
    // COLLATERAL
    // ---------------------------------------------------------------------

    function depositCollateral(address asset, uint256 amount) external whenNotPaused nonReentrant {
        require(supportedAssets[asset], "Asset khong duoc ho tro");
        require(amount > 0, "So luong phai > 0");

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        collateralBalance[msg.sender][asset] += amount;

        emit CollateralDeposited(msg.sender, asset, amount);
    }

    function withdrawCollateral(address asset, uint256 amount) external nonReentrant {
        require(collateralBalance[msg.sender][asset] >= amount, "Vuot qua so du the chap");

        collateralBalance[msg.sender][asset] -= amount;

        // Bat buoc: sau khi rut, Health Factor phai van an toan (>= 1.0), neu khong revert toan bo
        uint256 hf = _healthFactorAfter(msg.sender);
        require(hf >= HF_PRECISION || _totalDebtValueInUsdc(msg.sender) == 0, "Rut se lam Health Factor khong an toan");

        IERC20(asset).safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, asset, amount);
    }

    // ---------------------------------------------------------------------
    // BORROW / REPAY
    // ---------------------------------------------------------------------

    function borrow(address asset, uint256 amount) external whenNotPaused nonReentrant {
        require(supportedAssets[asset], "Asset khong duoc ho tro");
        require(amount > 0, "So luong phai > 0");

        _accrueInterest(msg.sender, asset);

        Loan storage loan = loans[msg.sender][asset];
        loan.principal += amount;
        loan.active = true;

        // Vay moi bi gioi han boi Max LTV (75%) - chat hon nguong thanh ly (83.3%),
        // tao vung dem an toan giua "vay duoc" va "bi thanh ly" dung y do spec.
        uint256 collateralValue = _totalCollateralValueInUsdc(msg.sender);
        uint256 debtValue = _totalDebtValueInUsdc(msg.sender);
        require(collateralValue > 0, "Chua co tai san the chap");
        uint256 currentLtvBps = (debtValue * BPS_DENOMINATOR) / collateralValue;
        require(currentLtvBps <= maxLtvBps, "Vay vuot qua Max LTV cho phep");

        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, asset, amount);
    }

    function repay(address asset, uint256 amount) external nonReentrant {
        _accrueInterest(msg.sender, asset);

        Loan storage loan = loans[msg.sender][asset];
        uint256 totalOwed = loan.principal + loan.accruedInterest;
        require(totalOwed > 0, "Khong co no can tra");

        uint256 payAmount = amount > totalOwed ? totalOwed : amount;

        IERC20(asset).safeTransferFrom(msg.sender, address(this), payAmount);

        // Tra lai truoc, sau do moi tru vao goc
        if (payAmount <= loan.accruedInterest) {
            loan.accruedInterest -= payAmount;
        } else {
            uint256 remainder = payAmount - loan.accruedInterest;
            loan.accruedInterest = 0;
            loan.principal -= remainder;
        }

        if (loan.principal == 0 && loan.accruedInterest == 0) {
            loan.active = false;
        }

        emit Repaid(msg.sender, asset, payAmount);
    }

    function _accrueInterest(address user, address asset) internal {
        Loan storage loan = loans[user][asset];
        if (!loan.active) {
            loan.lastAccrualTime = block.timestamp;
            return;
        }
        uint256 elapsed = block.timestamp - loan.lastAccrualTime;
        if (elapsed == 0) return;

        uint256 rate = borrowRatePerSecond[asset];
        uint256 interest = (loan.principal * rate * elapsed) / 1e18;
        loan.accruedInterest += interest;
        loan.lastAccrualTime = block.timestamp;
    }

    // ---------------------------------------------------------------------
    // HEALTH FACTOR (tinh theo PORTFOLIO, khong phai tung mon vay rieng le)
    // ---------------------------------------------------------------------

    /// @notice Tong gia tri tai san the chap cua user, quy ve USDC
    function _totalCollateralValueInUsdc(address user) internal returns (uint256 total) {
        total += collateralBalance[user][usdc];
        uint256 eurcCollateral = collateralBalance[user][eurc];
        if (eurcCollateral > 0) {
            total += _convert(eurc, usdc, eurcCollateral);
        }

        // Cong them so du dang stake trong StakingVault (neu da noi 2 contract)
        if (address(stakingVault) != address(0)) {
            uint256 stakedUsdc = stakingVault.getTotalStakedByUser(user, usdc);
            total += stakedUsdc;

            uint256 stakedEurc = stakingVault.getTotalStakedByUser(user, eurc);
            if (stakedEurc > 0) {
                total += _convert(eurc, usdc, stakedEurc);
            }
        }
    }

    /// @notice Tong no (goc + lai da tich luy) cua user, quy ve USDC.
    ///         Luu y: ham nay chi doc, khong accrue lai moi truoc khi goi tu ben ngoai HF view
    function _totalDebtValueInUsdc(address user) internal returns (uint256 total) {
        total += loans[user][usdc].principal + loans[user][usdc].accruedInterest;
        Loan storage eurcLoan = loans[user][eurc];
        uint256 eurcDebt = eurcLoan.principal + eurcLoan.accruedInterest;
        if (eurcDebt > 0) {
            total += _convert(eurc, usdc, eurcDebt);
        }
    }

    /// @notice Health Factor = (Collateral * LiquidationThreshold) / Debt, scale 1e18.
    ///         HF >= 1e18 (1.0) la an toan, la loai hoi.
    function _healthFactorAfter(address user) internal returns (uint256) {
        uint256 debt = _totalDebtValueInUsdc(user);
        if (debt == 0) return type(uint256).max;

        uint256 collateral = _totalCollateralValueInUsdc(user);
        uint256 adjustedCollateral = (collateral * liquidationThresholdBps) / BPS_DENOMINATOR;

        return (adjustedCollateral * HF_PRECISION) / debt;
    }

    /// @notice Ham public de UI/dashboard doc Health Factor hien tai cua user
    function getHealthFactor(address user) external returns (uint256) {
        return _healthFactorAfter(user);
    }

    // ---------------------------------------------------------------------
    // LIQUIDATION - CONG KHAI, AI CUNG GOI DUOC (khong the pause, theo spec)
    // ---------------------------------------------------------------------

    /// @notice Bat cu ai cung co the goi ham nay khi HF cua 1 user <= 1.0.
    ///         Nguoi goi (liquidator) tra no thay, doi lai nhan collateral + 5% thuong.
    ///         Phan collateral con lai sau khi tru no + thuong duoc tra ve cho chu no.
    function liquidate(address user, address debtAsset, uint256 debtToCover) external nonReentrant {
        _accrueInterest(user, debtAsset);

        uint256 hf = _healthFactorAfter(user);
        require(hf < HF_PRECISION, "Vi tri van an toan, chua the thanh ly");

        Loan storage loan = loans[user][debtAsset];
        uint256 totalOwed = loan.principal + loan.accruedInterest;
        require(totalOwed > 0, "Khong co no o asset nay");

        uint256 actualDebtToCover = debtToCover > totalOwed ? totalOwed : debtToCover;

        // Nguoi thanh ly tra no thay user
        IERC20(debtAsset).safeTransferFrom(msg.sender, address(this), actualDebtToCover);

        if (actualDebtToCover <= loan.accruedInterest) {
            loan.accruedInterest -= actualDebtToCover;
        } else {
            uint256 remainder = actualDebtToCover - loan.accruedInterest;
            loan.accruedInterest = 0;
            loan.principal -= remainder;
        }
        if (loan.principal == 0 && loan.accruedInterest == 0) {
            loan.active = false;
        }

        // Tinh collateral bi tich thu: gia tri no da tra + 5% thuong, quy doi sang loai collateral tuong ung
        address collateralAsset = debtAsset == usdc ? eurc : usdc;
        uint256 debtValueInCollateral = _convert(debtAsset, collateralAsset, actualDebtToCover);
        uint256 bonus = (debtValueInCollateral * liquidationBonusBps) / BPS_DENOMINATOR;
        uint256 collateralToSeize = debtValueInCollateral + bonus;

        uint256 available = collateralBalance[user][collateralAsset];
        if (collateralToSeize > available) {
            collateralToSeize = available; // khong duoc lay qua so du thuc te co
        }

        collateralBalance[user][collateralAsset] -= collateralToSeize;
        IERC20(collateralAsset).safeTransfer(msg.sender, collateralToSeize);

        emit Liquidated(user, msg.sender, debtAsset, actualDebtToCover, collateralToSeize);
    }
}
