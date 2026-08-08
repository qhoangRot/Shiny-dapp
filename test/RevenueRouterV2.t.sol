// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {RevenueRouterV2} from "../src/RevenueRouterV2.sol";
import {IRevenueRouterV2} from "../src/interfaces/IRevenueRouterV2.sol";
import {StakingVaultV2} from "../src/StakingVaultV2.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockInsuranceFundV2} from "./mocks/V2Mocks.sol";

contract RevenueRouterV2Test is Test {
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");
    MockERC20 internal usdc;
    MockERC20 internal eurc;
    StakingVaultV2 internal vault;
    MockInsuranceFundV2 internal insurance;
    RevenueRouterV2 internal router;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        vault = new StakingVaultV2(address(this), address(usdc), address(eurc));
        insurance = new MockInsuranceFundV2();
        router = new RevenueRouterV2(address(this), address(vault), address(insurance), treasury);
        vault.setRevenueRouter(address(router));
        router.setLendingPool(address(this));
    }

    function test_SplitsRevenueConservativelyAndCreditsRoundingDustToStakers() public {
        uint256 amount = 101;
        usdc.mint(address(this), amount);
        assertTrue(usdc.transfer(address(router), amount));

        (uint256 stakers, uint256 treasuryAmount, uint256 insuranceAmount, uint256 creditAmount) =
            router.routeRevenue(address(usdc), amount);

        assertEq(treasuryAmount, 15);
        assertEq(insuranceAmount, 10);
        assertEq(creditAmount, 10);
        assertEq(stakers, 66, "all integer rounding remainder belongs to stakers");
        assertEq(stakers + treasuryAmount + insuranceAmount + creditAmount, amount);
        assertEq(usdc.balanceOf(address(vault)), stakers);
        assertEq(vault.rewardReserve(address(usdc)), stakers);
        assertEq(usdc.balanceOf(address(insurance)), insuranceAmount);
        assertEq(insurance.totalInsuranceFromRevenue(address(usdc)), insuranceAmount);
        assertEq(usdc.balanceOf(treasury), treasuryAmount);
        assertEq(router.creditBonusReserve(address(usdc)), creditAmount);
        assertEq(usdc.balanceOf(address(router)), creditAmount);
    }

    function test_OnlyConfiguredLendingPoolCanRouteRevenue() public {
        vm.prank(stranger);
        vm.expectRevert(IRevenueRouterV2.Unauthorized.selector);
        router.routeRevenue(address(usdc), 1);
    }

    function test_RevertsWhenLendingPoolDidNotTransferExactRevenueFirst() public {
        vm.expectRevert(IRevenueRouterV2.InsufficientRevenueReceived.selector);
        router.routeRevenue(address(usdc), 1);
    }

    function test_CreditEscrowIsSeparatedPerAssetAcrossSettlements() public {
        usdc.mint(address(this), 100);
        eurc.mint(address(this), 200);
        assertTrue(usdc.transfer(address(router), 100));
        assertTrue(eurc.transfer(address(router), 200));

        router.routeRevenue(address(usdc), 100);
        router.routeRevenue(address(eurc), 200);

        assertEq(router.creditBonusReserve(address(usdc)), 10);
        assertEq(router.creditBonusReserve(address(eurc)), 20);
    }

    function test_LendingPoolCanOnlyBeSetOnce() public {
        vm.expectRevert(IRevenueRouterV2.DependencyAlreadySet.selector);
        router.setLendingPool(makeAddr("anotherPool"));
    }
}
