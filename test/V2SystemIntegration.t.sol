// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LendingPoolV2} from "../src/LendingPoolV2.sol";
import {StakingVaultV2} from "../src/StakingVaultV2.sol";
import {RevenueRouterV2} from "../src/RevenueRouterV2.sol";
import {InsuranceFundV2} from "../src/InsuranceFundV2.sol";
import {OracleAdapterV2} from "../src/oracle/OracleAdapterV2.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice End-to-end V2 path using real V2 dependencies; tokens are test fixtures only.
contract V2SystemIntegrationTest is Test {
    uint256 internal constant UNIT = 1e6;
    address internal alice = makeAddr("alice");
    address internal liquidator = makeAddr("liquidator");
    address internal treasury = makeAddr("treasury");

    MockERC20 internal usdc;
    MockERC20 internal eurc;
    OracleAdapterV2 internal oracle;
    StakingVaultV2 internal vault;
    InsuranceFundV2 internal insurance;
    RevenueRouterV2 internal router;
    LendingPoolV2 internal pool;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        oracle = new OracleAdapterV2(address(this));
        vault = new StakingVaultV2(address(this), address(usdc), address(eurc));
        insurance = new InsuranceFundV2(address(this));
        router = new RevenueRouterV2(address(this), address(vault), address(insurance), treasury);
        pool = new LendingPoolV2(
            address(this),
            address(usdc),
            address(eurc),
            address(vault),
            address(oracle),
            address(router),
            address(insurance)
        );

        vault.setLendingPool(address(pool));
        vault.setRevenueRouter(address(router));
        vault.setInsuranceFund(address(insurance));
        router.setLendingPool(address(pool));
        insurance.setLendingPool(address(pool));
        insurance.setRevenueRouter(address(router));
        insurance.setStakingVault(address(vault));
        oracle.setPrice(address(usdc), 1e18);
        oracle.setPrice(address(eurc), 1.08e18);

        usdc.mint(alice, 1_000 * UNIT);
        eurc.mint(address(this), 10_000 * UNIT);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        eurc.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        eurc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        pool.fundLiquidity(address(eurc), 10_000 * UNIT);
    }

    function test_RealV2DependenciesRouteBorrowInterest() public {
        vm.prank(alice);
        vault.stake(address(usdc), 1_000 * UNIT, StakingVaultV2.Tier.Flexible);
        pool.setBorrowRatePerSecond(address(eurc), 1e15);

        vm.prank(alice);
        pool.borrow(address(usdc), address(eurc), 500 * UNIT);
        eurc.mint(alice, 100 * UNIT);
        vm.warp(block.timestamp + 100);
        vm.prank(alice);
        pool.repay(address(eurc), type(uint256).max);

        uint256 interest = pool.pendingRevenue(address(eurc));
        pool.settleRevenue(address(eurc));

        uint256 insuranceAmount = interest * 1_000 / 10_000;
        assertGt(interest, 0);
        assertEq(insurance.totalInsuranceFromRevenue(address(eurc)), insuranceAmount);
        assertEq(insurance.availableInsurance(address(eurc)), insuranceAmount);
        assertEq(vault.rewardReserve(address(eurc)), interest - (interest * 3_500 / 10_000));
    }

    function test_RealV2DependenciesFinalizeAndResolveBadDebt() public {
        // Use parity for deterministic deficit arithmetic in this scenario.
        oracle.setPrice(address(eurc), 1e18);
        usdc.mint(alice, 105 * UNIT);
        vm.prank(alice);
        uint256 positionId = vault.stake(address(usdc), 105 * UNIT, StakingVaultV2.Tier.Flexible);
        pool.setBorrowRatePerSecond(address(eurc), 1e15);

        vm.prank(alice);
        pool.borrow(address(usdc), address(eurc), 75 * UNIT);
        vm.warp(block.timestamp + 350);

        eurc.mint(liquidator, 100 * UNIT);
        vm.prank(liquidator);
        eurc.approve(address(pool), type(uint256).max);
        uint256[] memory ids = new uint256[](1);
        ids[0] = positionId;
        vm.prank(liquidator);
        pool.liquidate(alice, address(eurc), address(usdc), type(uint256).max, ids, 0, block.timestamp);

        pool.finalizeBadDebt(alice, address(eurc));
        uint256 deficit = pool.protocolDeficit(address(eurc));
        assertGt(deficit, 0);

        // availableInsurance is intentionally the actual token balance, not a counter.
        eurc.mint(address(insurance), deficit);
        pool.resolveDeficitFromInsurance(address(eurc));

        assertEq(pool.protocolDeficit(address(eurc)), 0);
        assertEq(insurance.totalInsuranceUsedForBadDebt(address(eurc)), deficit);
    }

    function test_RealV2DependenciesRouteForfeitedRewardToInsurance() public {
        eurc.mint(alice, 1_000 * UNIT);
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
        usdc.mint(address(this), 10_000 * UNIT);
        usdc.approve(address(pool), type(uint256).max);
        pool.fundLiquidity(address(usdc), 10_000 * UNIT);

        vm.startPrank(alice);
        uint256 usdcPositionId = vault.stake(address(usdc), 500 * UNIT, StakingVaultV2.Tier.Flexible);
        uint256 eurcPositionId = vault.stake(address(eurc), 1_000 * UNIT, StakingVaultV2.Tier.Flexible);
        pool.borrow(address(eurc), address(usdc), 100 * UNIT);
        vm.stopPrank();

        pool.setBorrowRatePerSecond(address(usdc), 1e15);
        vm.warp(block.timestamp + 100);
        vm.prank(alice);
        pool.repay(address(usdc), type(uint256).max);

        uint256 interest = pool.pendingRevenue(address(usdc));
        pool.settleRevenue(address(usdc));
        uint256 rewardBeforeWithdrawal = vault.pendingReward(usdcPositionId);
        (,,,, uint256 stakedAt,,,,) = vault.positions(usdcPositionId);
        vm.warp(stakedAt + 90 days + (365 days - 90 days) / 2);

        vm.prank(alice);
        (, uint256 rewardPayout) = vault.withdraw(usdcPositionId);

        uint256 insuranceRevenue = interest * 1_000 / 10_000;
        uint256 expectedForfeiture = rewardBeforeWithdrawal / 2;
        assertEq(rewardPayout, rewardBeforeWithdrawal - expectedForfeiture);
        assertEq(insurance.totalInsuranceFromRevenue(address(usdc)), insuranceRevenue);
        assertEq(insurance.totalInsuranceFromForfeiture(address(usdc)), expectedForfeiture);
        assertEq(insurance.availableInsurance(address(usdc)), insuranceRevenue + expectedForfeiture);

        // The EURC position remained as collateral until the debt was repaid.
        (,,, uint256 eurcPrincipal,,,,,) = vault.positions(eurcPositionId);
        assertEq(eurcPrincipal, 1_000 * UNIT);
    }
}
