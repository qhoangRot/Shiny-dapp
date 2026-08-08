// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StakingVaultV2} from "../src/StakingVaultV2.sol";
import {InsuranceFundV2} from "../src/InsuranceFundV2.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockRevenueRouterV2} from "./mocks/V2Mocks.sol";

contract StakingVaultV2Test is Test {
    uint256 internal constant UNIT = 1e6;

    address internal alice = makeAddr("alice");
    address internal liquidator = makeAddr("liquidator");

    MockERC20 internal usdc;
    MockERC20 internal eurc;
    MockRevenueRouterV2 internal router;
    StakingVaultV2 internal vault;
    InsuranceFundV2 internal insurance;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        router = new MockRevenueRouterV2();
        vault = new StakingVaultV2(address(this), address(usdc), address(eurc));
        insurance = new InsuranceFundV2(address(this));
        vault.setLendingPool(address(this));
        vault.setRevenueRouter(address(router));
        vault.setInsuranceFund(address(insurance));
        insurance.setStakingVault(address(vault));

        usdc.mint(alice, 2_000 * UNIT);
        usdc.mint(address(this), 1_000 * UNIT);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);
    }

    function test_PartialSeizeCheckpointsRewardsWithoutLoss() public {
        vm.prank(alice);
        uint256 positionId = vault.stake(address(usdc), 1_000 * UNIT, StakingVaultV2.Tier.Flexible);

        router.fundAndNotify(address(vault), address(usdc), 100 * UNIT);
        vault.seizeStakedCollateral(alice, address(usdc), _oneId(positionId), 200 * UNIT, liquidator);
        assertEq(vault.pendingReward(positionId), 100 * UNIT);

        router.fundAndNotify(address(vault), address(usdc), 80 * UNIT);
        vault.seizeStakedCollateral(alice, address(usdc), _oneId(positionId), 300 * UNIT, liquidator);
        assertEq(vault.pendingReward(positionId), 180 * UNIT);

        vm.prank(alice);
        uint256 claimed = vault.claimReward(positionId);
        assertEq(claimed, 180 * UNIT);
        (,,, uint256 principal,,,,,) = vault.positions(positionId);
        assertEq(principal, 500 * UNIT);
        assertEq(usdc.balanceOf(liquidator), 500 * UNIT);
    }

    function testFuzz_RepeatedPartialSeizePreservesPrincipalAndAccruedReward(uint96 rawFirst, uint96 rawSecond) public {
        uint256 first = bound(uint256(rawFirst), 1, 499 * UNIT);
        uint256 second = bound(uint256(rawSecond), 1, 999 * UNIT - first);

        vm.prank(alice);
        uint256 positionId = vault.stake(address(usdc), 1_000 * UNIT, StakingVaultV2.Tier.Flexible);
        router.fundAndNotify(address(vault), address(usdc), 100 * UNIT);
        vault.seizeStakedCollateral(alice, address(usdc), _oneId(positionId), first, liquidator);
        uint256 rewardAfterFirst = vault.pendingReward(positionId);

        router.fundAndNotify(address(vault), address(usdc), 50 * UNIT);
        vault.seizeStakedCollateral(alice, address(usdc), _oneId(positionId), second, liquidator);
        uint256 rewardAfterSecond = vault.pendingReward(positionId);

        (,,, uint256 principal,,,,,) = vault.positions(positionId);
        assertEq(principal + first + second, 1_000 * UNIT);
        assertGe(rewardAfterSecond, rewardAfterFirst, "checkpoint lost accrued reward");
        assertLe(rewardAfterSecond, 150 * UNIT, "rounding created reward");
        assertLe(150 * UNIT - rewardAfterSecond, 2, "unexpected rounding loss");
    }

    function test_FlexibleWithdrawImmediatelyForfeitsAllAccruedRewardButNeverPrincipal() public {
        vm.prank(alice);
        uint256 positionId = vault.stake(address(usdc), 100 * UNIT, StakingVaultV2.Tier.Flexible);
        router.fundAndNotify(address(vault), address(usdc), 10 * UNIT);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        (uint256 principal, uint256 reward) = vault.withdraw(positionId);

        assertEq(principal, 100 * UNIT);
        assertEq(reward, 0);
        assertEq(usdc.balanceOf(alice) - aliceBefore, 100 * UNIT);
        assertEq(insurance.totalInsuranceFromForfeiture(address(usdc)), 10 * UNIT);
        assertEq(insurance.availableInsurance(address(usdc)), 10 * UNIT);
    }

    function test_WithdrawalPenaltyDeclinesLinearlyBetweenThreeAndTwelveMonths() public {
        vm.prank(alice);
        uint256 positionId = vault.stake(address(usdc), 100 * UNIT, StakingVaultV2.Tier.Flexible);
        router.fundAndNotify(address(vault), address(usdc), 100 * UNIT);

        vm.warp(block.timestamp + 90 days + (365 days - 90 days) / 2);
        vm.prank(alice);
        (uint256 principal, uint256 reward) = vault.withdraw(positionId);

        assertEq(principal, 100 * UNIT);
        assertEq(reward, 50 * UNIT);
        assertEq(insurance.totalInsuranceFromForfeiture(address(usdc)), 50 * UNIT);
        assertEq(insurance.availableInsurance(address(usdc)), 50 * UNIT);
    }

    function test_EmergencyWithdrawBypassesLockAndPenaltyEndsAfterTwelveMonths() public {
        vm.prank(alice);
        uint256 earlyPositionId = vault.stake(address(usdc), 100 * UNIT, StakingVaultV2.Tier.Growth);
        router.fundAndNotify(address(vault), address(usdc), 20 * UNIT);
        uint256 accruedBeforeEarlyWithdrawal = vault.pendingReward(earlyPositionId);

        vm.prank(alice);
        (uint256 earlyPrincipal, uint256 earlyReward) = vault.emergencyWithdraw(earlyPositionId);
        assertEq(earlyPrincipal, 100 * UNIT);
        assertEq(earlyReward, 0);
        assertEq(insurance.totalInsuranceFromForfeiture(address(usdc)), accruedBeforeEarlyWithdrawal);

        vm.prank(alice);
        uint256 maturePositionId = vault.stake(address(usdc), 100 * UNIT, StakingVaultV2.Tier.Diamond);
        router.fundAndNotify(address(vault), address(usdc), 20 * UNIT);
        vm.warp(block.timestamp + 365 days);
        uint256 accruedBeforeMatureWithdrawal = vault.pendingReward(maturePositionId);

        vm.prank(alice);
        (uint256 maturePrincipal, uint256 matureReward) = vault.emergencyWithdraw(maturePositionId);
        assertEq(maturePrincipal, 100 * UNIT);
        assertEq(matureReward, accruedBeforeMatureWithdrawal, "mature reward must not be penalized");
        assertEq(insurance.totalInsuranceFromForfeiture(address(usdc)), accruedBeforeEarlyWithdrawal);
    }

    /// @dev Serves as the configured withdrawal validator in these unit tests.
    function validateWithdrawal(address, address, uint256) external {}

    function _oneId(uint256 positionId) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = positionId;
    }
}
