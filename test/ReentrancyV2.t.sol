// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LendingPoolV2} from "../src/LendingPoolV2.sol";
import {StakingVaultV2} from "../src/StakingVaultV2.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {
    MockOracleV2,
    MockRevenueRouterV2,
    MockInsuranceFundV2,
    ReentrantMockERC20,
    MockStakingVaultV2,
    ReentrantInsuranceFundV2
} from "./mocks/V2Mocks.sol";

contract ReentrancyV2Test is Test {
    uint256 internal constant UNIT = 1e6;
    address internal alice = makeAddr("alice");
    address internal liquidator = makeAddr("liquidator");

    function test_ReentrancyBlockedDuringExactTokenPull() public {
        ReentrantMockERC20 usdc = new ReentrantMockERC20("USD Coin", "USDC", 6);
        MockERC20 eurc = new MockERC20("Euro Coin", "EURC", 6);
        (LendingPoolV2 pool,) = _deployWithRealVault(address(usdc), address(eurc));

        usdc.mint(address(this), 100 * UNIT);
        usdc.approve(address(pool), type(uint256).max);
        usdc.armCallback(address(pool), abi.encodeCall(pool.coverDeficit, (address(usdc), 1)), true, false);

        pool.fundLiquidity(address(usdc), 100 * UNIT);
        assertTrue(usdc.callbackAttempted());
        assertFalse(usdc.callbackSucceeded(), "nested nonReentrant entry succeeded");
        assertEq(usdc.balanceOf(address(pool)), 100 * UNIT);
    }

    function test_ReentrancyBlockedDuringVaultCollateralTransfer() public {
        ReentrantMockERC20 usdc = new ReentrantMockERC20("USD Coin", "USDC", 6);
        MockERC20 eurc = new MockERC20("Euro Coin", "EURC", 6);
        (LendingPoolV2 pool, StakingVaultV2 vault) = _deployWithRealVault(address(usdc), address(eurc));
        MockOracleV2 oracle = MockOracleV2(address(pool.oracle()));

        usdc.mint(alice, 1_000 * UNIT);
        eurc.mint(address(this), 1_000 * UNIT);
        eurc.mint(liquidator, 1_000 * UNIT);
        eurc.approve(address(pool), type(uint256).max);
        pool.fundLiquidity(address(eurc), 1_000 * UNIT);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(liquidator);
        eurc.approve(address(pool), type(uint256).max);

        vm.prank(alice);
        uint256 positionId = vault.stake(address(usdc), 1_000 * UNIT, StakingVaultV2.Tier.Flexible);
        vm.prank(alice);
        pool.borrow(address(usdc), address(eurc), 700 * UNIT);
        oracle.setPrice(address(eurc), 1.2e18);

        usdc.armCallback(address(pool), abi.encodeCall(pool.coverDeficit, (address(usdc), 1)), false, true);
        uint256[] memory ids = new uint256[](1);
        ids[0] = positionId;
        vm.prank(liquidator);
        pool.liquidate(alice, address(eurc), address(usdc), 100 * UNIT, ids, 0, block.timestamp);

        assertTrue(usdc.callbackAttempted());
        assertFalse(usdc.callbackSucceeded(), "nested callback from Vault succeeded");
    }

    function test_ReentrancyBlockedDuringInsuranceCoverage() public {
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockERC20 eurc = new MockERC20("Euro Coin", "EURC", 6);
        MockOracleV2 oracle = new MockOracleV2();
        MockRevenueRouterV2 router = new MockRevenueRouterV2();
        MockStakingVaultV2 vault = new MockStakingVaultV2();
        ReentrantInsuranceFundV2 insurance = new ReentrantInsuranceFundV2();
        LendingPoolV2 pool = new LendingPoolV2(
            address(this),
            address(usdc),
            address(eurc),
            address(vault),
            address(oracle),
            address(router),
            address(insurance)
        );

        oracle.setPrice(address(usdc), 1e18);
        oracle.setPrice(address(eurc), 1e18);
        oracle.setHealthy(address(usdc), true);
        oracle.setHealthy(address(eurc), true);
        vault.setPrincipal(alice, address(usdc), 1_000 * UNIT);
        eurc.mint(address(this), 1_000 * UNIT);
        eurc.approve(address(pool), type(uint256).max);
        pool.fundLiquidity(address(eurc), 1_000 * UNIT);

        vm.prank(alice);
        pool.borrow(address(usdc), address(eurc), 100 * UNIT);
        vault.setPrincipal(alice, address(usdc), 0);
        pool.finalizeBadDebt(alice, address(eurc));

        eurc.mint(address(insurance), 100 * UNIT);
        insurance.armCallback(address(pool), abi.encodeCall(pool.coverDeficit, (address(eurc), 1)));
        pool.resolveDeficitFromInsurance(address(eurc));

        assertTrue(insurance.callbackAttempted());
        assertFalse(insurance.callbackSucceeded(), "nested insurance callback succeeded");
        assertEq(pool.protocolDeficit(address(eurc)), 0);
    }

    function _deployWithRealVault(address usdc, address eurc)
        internal
        returns (LendingPoolV2 pool, StakingVaultV2 vault)
    {
        MockOracleV2 oracle = new MockOracleV2();
        MockRevenueRouterV2 router = new MockRevenueRouterV2();
        MockInsuranceFundV2 insurance = new MockInsuranceFundV2();
        vault = new StakingVaultV2(address(this), usdc, eurc);
        pool = new LendingPoolV2(
            address(this), usdc, eurc, address(vault), address(oracle), address(router), address(insurance)
        );
        vault.setLendingPool(address(pool));
        vault.setRevenueRouter(address(router));
        oracle.setPrice(usdc, 1e18);
        oracle.setPrice(eurc, 1e18);
        oracle.setHealthy(usdc, true);
        oracle.setHealthy(eurc, true);
    }
}
