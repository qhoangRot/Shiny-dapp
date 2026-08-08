// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {InsuranceFundV2} from "../src/InsuranceFundV2.sol";
import {IInsuranceFundV2} from "../src/interfaces/IInsuranceFundV2.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract InsuranceFundV2Test is Test {
    address internal lendingPool = makeAddr("lendingPool");
    address internal revenueRouter = makeAddr("revenueRouter");
    address internal stakingVault = makeAddr("stakingVault");
    address internal recipient = makeAddr("recipient");
    address internal stranger = makeAddr("stranger");

    MockERC20 internal usdc;
    InsuranceFundV2 internal fund;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        fund = new InsuranceFundV2(address(this));
        fund.setLendingPool(lendingPool);
        fund.setRevenueRouter(revenueRouter);
        fund.setStakingVault(stakingVault);
    }

    function test_TracksForfeitureAndRevenueAsSeparateCumulativeCounters() public {
        _transferThenNotify(stakingVault, 40, true);
        _transferThenNotify(revenueRouter, 60, false);

        assertEq(fund.totalInsuranceFromForfeiture(address(usdc)), 40);
        assertEq(fund.totalInsuranceFromRevenue(address(usdc)), 60);
        assertEq(fund.totalInsuranceUsedForBadDebt(address(usdc)), 0);
        assertEq(fund.availableInsurance(address(usdc)), 100);
        assertEq(fund.accountedBalance(address(usdc)), 100);
    }

    function test_CoverDeficitCapsAtActualTokenBalance() public {
        _transferThenNotify(revenueRouter, 100, false);

        vm.prank(lendingPool);
        fund.coverDeficit(address(usdc), 150, recipient);

        assertEq(usdc.balanceOf(recipient), 100);
        assertEq(fund.availableInsurance(address(usdc)), 0);
        assertEq(fund.totalInsuranceUsedForBadDebt(address(usdc)), 100);
        assertEq(fund.totalInsuranceFromRevenue(address(usdc)), 100, "history must not decrease");
    }

    function test_OnlyAuthorizedSourceMayRecordItsContributionType() public {
        vm.prank(stranger);
        vm.expectRevert(IInsuranceFundV2.Unauthorized.selector);
        fund.notifyForfeiture(address(usdc), 1);

        vm.prank(stranger);
        vm.expectRevert(IInsuranceFundV2.Unauthorized.selector);
        fund.notifyRevenueContribution(address(usdc), 1);

        vm.prank(stranger);
        vm.expectRevert(IInsuranceFundV2.Unauthorized.selector);
        fund.coverDeficit(address(usdc), 1, recipient);
    }

    function test_ContributionCannotBeRecordedWithoutPriorTransfer() public {
        vm.prank(revenueRouter);
        vm.expectRevert(IInsuranceFundV2.InsufficientContributionReceived.selector);
        fund.notifyRevenueContribution(address(usdc), 1);
    }

    function test_DependencyAddressesAreSetOnce() public {
        vm.expectRevert(IInsuranceFundV2.DependencyAlreadySet.selector);
        fund.setLendingPool(makeAddr("anotherPool"));
        vm.expectRevert(IInsuranceFundV2.DependencyAlreadySet.selector);
        fund.setRevenueRouter(makeAddr("anotherRouter"));
        vm.expectRevert(IInsuranceFundV2.DependencyAlreadySet.selector);
        fund.setStakingVault(makeAddr("anotherVault"));
    }

    function _transferThenNotify(address source, uint256 amount, bool forfeiture) internal {
        usdc.mint(source, amount);
        vm.prank(source);
        assertTrue(usdc.transfer(address(fund), amount));
        vm.prank(source);
        if (forfeiture) {
            fund.notifyForfeiture(address(usdc), amount);
        } else {
            fund.notifyRevenueContribution(address(usdc), amount);
        }
    }
}
