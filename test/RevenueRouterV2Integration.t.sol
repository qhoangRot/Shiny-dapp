// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LendingPoolV2} from "../src/LendingPoolV2.sol";
import {StakingVaultV2} from "../src/StakingVaultV2.sol";
import {RevenueRouterV2} from "../src/RevenueRouterV2.sol";
import {OracleAdapterV2} from "../src/oracle/OracleAdapterV2.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockInsuranceFundV2} from "./mocks/V2Mocks.sol";

contract RevenueRouterV2IntegrationTest is Test {
    uint256 internal constant UNIT = 1e6;
    address internal alice = makeAddr("alice");
    address internal treasury = makeAddr("treasury");

    MockERC20 internal usdc;
    MockERC20 internal eurc;
    OracleAdapterV2 internal oracle;
    StakingVaultV2 internal vault;
    MockInsuranceFundV2 internal insurance;
    RevenueRouterV2 internal router;
    LendingPoolV2 internal pool;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        oracle = new OracleAdapterV2(address(this));
        vault = new StakingVaultV2(address(this), address(usdc), address(eurc));
        insurance = new MockInsuranceFundV2();
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
        router.setLendingPool(address(pool));
        oracle.setPrice(address(usdc), 1e18);
        oracle.setPrice(address(eurc), 1.08e18);

        usdc.mint(alice, 1_000 * UNIT);
        eurc.mint(address(this), 10_000 * UNIT);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        eurc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        pool.fundLiquidity(address(eurc), 10_000 * UNIT);
    }

    function test_RepaySettlementRoutesInterestToEveryDestination() public {
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
        assertGt(interest, 0);

        pool.settleRevenue(address(eurc));

        uint256 treasuryAmount = interest * 1_500 / 10_000;
        uint256 insuranceAmount = interest * 1_000 / 10_000;
        uint256 creditAmount = interest * 1_000 / 10_000;
        uint256 stakerAmount = interest - treasuryAmount - insuranceAmount - creditAmount;
        assertEq(pool.pendingRevenue(address(eurc)), 0);
        assertEq(eurc.balanceOf(treasury), treasuryAmount);
        assertEq(eurc.balanceOf(address(insurance)), insuranceAmount);
        assertEq(vault.rewardReserve(address(eurc)), stakerAmount);
        assertEq(router.creditBonusReserve(address(eurc)), creditAmount);
    }
}
