// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IInsuranceFundV2} from "./interfaces/IInsuranceFundV2.sol";

/// @title InsuranceFundV2
/// @notice Same-asset reserve for protocol deficits, with source-attribution counters.
/// @dev Counter values are cumulative history. availableInsurance always reads token balance.
contract InsuranceFundV2 is IInsuranceFundV2, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public lendingPool;
    address public revenueRouter;
    address public stakingVault;

    mapping(address => uint256) public override totalInsuranceFromForfeiture;
    mapping(address => uint256) public override totalInsuranceFromRevenue;
    mapping(address => uint256) public override totalInsuranceUsedForBadDebt;

    /// @dev Last balance observed during an authorized contribution or coverage operation.
    ///      It lets transfer-before-notify callers prove that at least `amount` arrived.
    mapping(address => uint256) public accountedBalance;

    event LendingPoolSet(address indexed lendingPool);
    event RevenueRouterSet(address indexed revenueRouter);
    event StakingVaultSet(address indexed stakingVault);

    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
    }

    modifier onlyLendingPool() {
        if (msg.sender != lendingPool) revert Unauthorized();
        _;
    }

    modifier onlyRevenueRouter() {
        if (msg.sender != revenueRouter) revert Unauthorized();
        _;
    }

    modifier onlyStakingVault() {
        if (msg.sender != stakingVault) revert Unauthorized();
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

    function setStakingVault(address stakingVaultAddress) external onlyOwner {
        if (stakingVaultAddress == address(0)) revert ZeroAddress();
        if (stakingVault != address(0)) revert DependencyAlreadySet();
        stakingVault = stakingVaultAddress;
        emit StakingVaultSet(stakingVaultAddress);
    }

    /// @inheritdoc IInsuranceFundV2
    function availableInsurance(address asset) public view override returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    /// @notice Records reward forfeiture transferred by StakingVaultV2 before this call.
    /// @dev V2 does not yet expose early withdrawal; this guarded ABI is reserved for it.
    function notifyForfeiture(address asset, uint256 amount) external override onlyStakingVault nonReentrant {
        _recordContribution(asset, amount);
        totalInsuranceFromForfeiture[asset] += amount;
        emit ForfeitureReceived(asset, amount);
    }

    /// @notice Records revenue transferred by RevenueRouterV2 before this call.
    function notifyRevenueContribution(address asset, uint256 amount) external override onlyRevenueRouter nonReentrant {
        _recordContribution(asset, amount);
        totalInsuranceFromRevenue[asset] += amount;
        emit RevenueContributionReceived(asset, amount);
    }

    /// @inheritdoc IInsuranceFundV2
    function coverDeficit(address asset, uint256 requested, address recipient)
        external
        override
        onlyLendingPool
        nonReentrant
    {
        if (requested == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();

        uint256 available = availableInsurance(asset);
        if (available == 0) revert InsufficientInsuranceBalance();
        uint256 amount = requested < available ? requested : available;

        uint256 fundBalanceBefore = available;
        uint256 recipientBalanceBefore = IERC20(asset).balanceOf(recipient);
        totalInsuranceUsedForBadDebt[asset] += amount;
        IERC20(asset).safeTransfer(recipient, amount);

        uint256 fundBalanceAfter = IERC20(asset).balanceOf(address(this));
        uint256 recipientBalanceAfter = IERC20(asset).balanceOf(recipient);
        if (fundBalanceBefore - fundBalanceAfter != amount || recipientBalanceAfter - recipientBalanceBefore != amount) revert TokenReceiptMismatch();
        accountedBalance[asset] = fundBalanceAfter;

        emit DeficitCovered(asset, recipient, amount);
    }

    function _recordContribution(address asset, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        uint256 balance = availableInsurance(asset);
        if (balance < amount || balance - amount < accountedBalance[asset]) {
            revert InsufficientContributionReceived();
        }
        accountedBalance[asset] = balance;
    }
}
