// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IRevenueRouterV2} from "./interfaces/IRevenueRouterV2.sol";
import {IStakingVaultV2} from "./interfaces/IStakingVaultV2.sol";
import {IInsuranceFundV2} from "./interfaces/IInsuranceFundV2.sol";

/// @title RevenueRouterV2
/// @notice Permissioned revenue splitter for LendingPoolV2 interest settlement.
/// @dev Credit allocations remain escrowed here until a production credit system is audited.
contract RevenueRouterV2 is IRevenueRouterV2, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant TREASURY_BPS = 1_500;
    uint256 private constant INSURANCE_BPS = 1_000;
    uint256 private constant CREDIT_BPS = 1_000;

    IStakingVaultV2 public immutable stakingVault;
    IInsuranceFundV2 public immutable insuranceFund;
    address public immutable treasury;
    address public lendingPool;

    /// @notice Same-asset credit allocation held in escrow pending a production credit engine.
    mapping(address => uint256) public creditBonusReserve;

    event LendingPoolSet(address indexed lendingPool);

    constructor(
        address initialOwner,
        address stakingVaultAddress,
        address insuranceFundAddress,
        address treasuryAddress
    ) Ownable(initialOwner) {
        if (
            initialOwner == address(0) || stakingVaultAddress == address(0) || insuranceFundAddress == address(0)
                || treasuryAddress == address(0)
        ) revert ZeroAddress();

        stakingVault = IStakingVaultV2(stakingVaultAddress);
        insuranceFund = IInsuranceFundV2(insuranceFundAddress);
        treasury = treasuryAddress;
    }

    modifier onlyLendingPool() {
        if (msg.sender != lendingPool) revert Unauthorized();
        _;
    }

    function setLendingPool(address lendingPoolAddress) external onlyOwner {
        if (lendingPoolAddress == address(0)) revert ZeroAddress();
        if (lendingPool != address(0)) revert DependencyAlreadySet();
        lendingPool = lendingPoolAddress;
        emit LendingPoolSet(lendingPoolAddress);
    }

    /// @inheritdoc IRevenueRouterV2
    function routeRevenue(address asset, uint256 amount)
        external
        override
        onlyLendingPool
        nonReentrant
        returns (uint256 stakerAmount, uint256 treasuryAmount, uint256 insuranceAmount, uint256 creditAmount)
    {
        if (amount == 0) revert ZeroAmount();

        treasuryAmount = Math.mulDiv(amount, TREASURY_BPS, BPS_DENOMINATOR);
        insuranceAmount = Math.mulDiv(amount, INSURANCE_BPS, BPS_DENOMINATOR);
        creditAmount = Math.mulDiv(amount, CREDIT_BPS, BPS_DENOMINATOR);
        stakerAmount = amount - treasuryAmount - insuranceAmount - creditAmount;

        // LendingPoolV2 transfers before calling routeRevenue. The only balance this
        // router retains across settlements is the separately accounted credit escrow.
        uint256 requiredBalance = creditBonusReserve[asset] + amount;
        if (IERC20(asset).balanceOf(address(this)) < requiredBalance) revert InsufficientRevenueReceived();
        creditBonusReserve[asset] += creditAmount;

        if (stakerAmount != 0) {
            _transferExact(asset, address(stakingVault), stakerAmount);
            stakingVault.notifyReward(asset, stakerAmount);
        }
        if (insuranceAmount != 0) {
            _transferExact(asset, address(insuranceFund), insuranceAmount);
            insuranceFund.notifyRevenueContribution(asset, insuranceAmount);
        }
        if (treasuryAmount != 0) {
            _transferExact(asset, treasury, treasuryAmount);
        }

        emit RevenueSettled(asset, amount, stakerAmount, treasuryAmount, insuranceAmount, creditAmount);
    }

    function _transferExact(address asset, address recipient, uint256 amount) internal {
        uint256 balanceBefore = IERC20(asset).balanceOf(recipient);
        IERC20(asset).safeTransfer(recipient, amount);
        if (IERC20(asset).balanceOf(recipient) - balanceBefore != amount) revert TokenReceiptMismatch();
    }
}
