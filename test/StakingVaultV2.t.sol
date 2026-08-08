// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StakingVaultV2} from "../src/StakingVaultV2.sol";
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

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        router = new MockRevenueRouterV2();
        vault = new StakingVaultV2(address(this), address(usdc), address(eurc));
        vault.setLendingPool(address(this));
        vault.setRevenueRouter(address(router));

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
        (,,, uint256 principal,,,,) = vault.positions(positionId);
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

        (,,, uint256 principal,,,,) = vault.positions(positionId);
        assertEq(principal + first + second, 1_000 * UNIT);
        assertGe(rewardAfterSecond, rewardAfterFirst, "checkpoint lost accrued reward");
        assertLe(rewardAfterSecond, 150 * UNIT, "rounding created reward");
        assertLe(150 * UNIT - rewardAfterSecond, 2, "unexpected rounding loss");
    }

    function _oneId(uint256 positionId) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = positionId;
    }
}
