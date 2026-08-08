// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LendingPoolV2} from "../src/LendingPoolV2.sol";
import {StakingVaultV2} from "../src/StakingVaultV2.sol";
import {ILendingPoolV2} from "../src/interfaces/ILendingPoolV2.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockOracleV2, MockRevenueRouterV2, MockInsuranceFundV2} from "./mocks/V2Mocks.sol";

contract LendingPoolV2Test is Test {
    uint256 internal constant UNIT = 1e6;

    address internal alice = makeAddr("alice");
    address internal liquidator = makeAddr("liquidator");

    MockERC20 internal usdc;
    MockERC20 internal eurc;
    MockOracleV2 internal oracle;
    MockRevenueRouterV2 internal router;
    MockInsuranceFundV2 internal insurance;
    StakingVaultV2 internal vault;
    LendingPoolV2 internal pool;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        oracle = new MockOracleV2();
        router = new MockRevenueRouterV2();
        insurance = new MockInsuranceFundV2();
        vault = new StakingVaultV2(address(this), address(usdc), address(eurc));
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

        oracle.setPrice(address(usdc), 1e18);
        oracle.setPrice(address(eurc), 1e18);
        oracle.setHealthy(address(usdc), true);
        oracle.setHealthy(address(eurc), true);

        usdc.mint(alice, 10_000 * UNIT);
        eurc.mint(alice, 10_000 * UNIT);
        eurc.mint(liquidator, 10_000 * UNIT);
        eurc.mint(address(this), 1_000_000 * UNIT);

        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        eurc.approve(address(vault), type(uint256).max);
        vm.prank(liquidator);
        eurc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        pool.fundLiquidity(address(eurc), 500_000 * UNIT);
    }

    function test_LiquidationPreservesDebtAndCollateralAccounting() public {
        uint256 positionId = _stake(alice, usdc, 1_000 * UNIT);
        _borrow(alice, address(usdc), address(eurc), 700 * UNIT);
        oracle.setPrice(address(eurc), 1.2e18);

        uint256[] memory ids = _oneId(positionId);
        uint256 poolDebtBalanceBefore = eurc.balanceOf(address(pool));
        uint256 liquidatorCollateralBefore = usdc.balanceOf(liquidator);

        vm.prank(liquidator);
        (uint256 debtCovered, uint256 collateralSeized) =
            pool.liquidate(alice, address(eurc), address(usdc), 700 * UNIT, ids, 0, block.timestamp);

        assertEq(debtCovered, 350 * UNIT, "standard close factor must cap debt");
        assertEq(collateralSeized, 441 * UNIT, "collateral plus bonus mismatch");
        assertEq(eurc.balanceOf(address(pool)) - poolDebtBalanceBefore, debtCovered, "pool did not receive debt");
        assertEq(usdc.balanceOf(liquidator) - liquidatorCollateralBefore, collateralSeized, "recipient mismatch");

        (uint256 principal,,,) = pool.loans(alice, address(eurc));
        (,,, uint256 remainingPrincipal,,,,,) = vault.positions(positionId);
        assertEq(principal, 350 * UNIT, "loan principal mismatch");
        assertEq(remainingPrincipal, 1_000 * UNIT - collateralSeized, "position principal mismatch");
        assertLe(collateralSeized, 1_000 * UNIT, "selected collateral exceeded");
    }

    function testFuzz_LiquidationNeverExceedsRequestDebtOrSelectedCollateral(uint96 rawRequest) public {
        uint256 requested = bound(uint256(rawRequest), 1, 700 * UNIT);
        uint256 positionId = _stake(alice, usdc, 1_000 * UNIT);
        _borrow(alice, address(usdc), address(eurc), 700 * UNIT);
        oracle.setPrice(address(eurc), 1.2e18);

        vm.prank(liquidator);
        (uint256 covered, uint256 seized) =
            pool.liquidate(alice, address(eurc), address(usdc), requested, _oneId(positionId), 0, block.timestamp);

        assertLe(covered, requested);
        assertLe(covered, 350 * UNIT);
        assertLe(seized, 1_000 * UNIT);
        (,,, uint256 remainingPrincipal,,,,,) = vault.positions(positionId);
        assertEq(remainingPrincipal + seized, 1_000 * UNIT);
    }

    function test_FinalizeBadDebtRevertsWhileAnotherEligibleCollateralAssetRemains() public {
        pool.configureBorrowPair(address(eurc), address(eurc), true);
        uint256 usdcPosition = _stake(alice, usdc, 1_050 * UNIT);
        _stake(alice, eurc, 100 * UNIT);
        _borrow(alice, address(usdc), address(eurc), 800 * UNIT);
        oracle.setPrice(address(eurc), 2e18);

        vm.prank(liquidator);
        (, uint256 seized) =
            pool.liquidate(alice, address(eurc), address(usdc), 800 * UNIT, _oneId(usdcPosition), 0, block.timestamp);
        assertEq(seized, 1_050 * UNIT, "first collateral asset should be exhausted");
        assertEq(vault.getTotalSeizablePrincipal(alice, address(usdc)), 0);
        assertEq(vault.getTotalSeizablePrincipal(alice, address(eurc)), 100 * UNIT);

        vm.expectRevert(ILendingPoolV2.CollateralRemaining.selector);
        pool.finalizeBadDebt(alice, address(eurc));
        assertEq(pool.protocolDeficit(address(eurc)), 0, "deficit realized too early");
    }

    function test_BorrowUsesDedicatedInsufficientCollateralError() public {
        _stake(alice, usdc, 100 * UNIT);
        vm.prank(alice);
        vm.expectRevert(ILendingPoolV2.InsufficientCollateral.selector);
        pool.borrow(address(usdc), address(eurc), 76 * UNIT);
    }

    function test_OracleHealthIsEnforcedBeforeBorrowAndLiquidation() public {
        uint256 positionId = _stake(alice, usdc, 1_000 * UNIT);
        oracle.setHealthy(address(eurc), false);
        vm.prank(alice);
        vm.expectRevert(ILendingPoolV2.DebtAssetSuspended.selector);
        pool.borrow(address(usdc), address(eurc), 100 * UNIT);

        oracle.setHealthy(address(eurc), true);
        _borrow(alice, address(usdc), address(eurc), 700 * UNIT);
        oracle.setPrice(address(eurc), 1.2e18);
        oracle.setHealthy(address(usdc), false);
        vm.prank(liquidator);
        vm.expectRevert(ILendingPoolV2.OracleUnhealthy.selector);
        pool.liquidate(alice, address(eurc), address(usdc), 100 * UNIT, _oneId(positionId), 0, block.timestamp);
    }

    function _stake(address user, MockERC20 asset, uint256 amount) internal returns (uint256 positionId) {
        vm.prank(user);
        positionId = vault.stake(address(asset), amount, StakingVaultV2.Tier.Flexible);
    }

    function _borrow(address user, address collateralAsset, address debtAsset, uint256 amount) internal {
        vm.prank(user);
        pool.borrow(collateralAsset, debtAsset, amount);
    }

    function _oneId(uint256 positionId) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = positionId;
    }
}
