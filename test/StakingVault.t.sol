// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/StakingVault.sol";
import "./mocks/MockERC20.sol";

contract StakingVaultTest is Test {
    StakingVault public vault;
    MockERC20 public usdc;

    address public owner = address(this);
    address public alice = address(0xA11CE);

    uint256 constant REWARD_RATE = 3_170_000_000; // ~10%/nam, scale 1e18

    function setUp() public {
        vault = new StakingVault(owner);
        usdc = new MockERC20("USD Coin", "USDC", 6);

        vault.setSupportedAsset(address(usdc), true);
        vault.setRewardRatePerSecond(address(usdc), REWARD_RATE);
        vault.setTierBoostBps(StakingVault.Tier.Growth, 100);
        vault.setTierBoostBps(StakingVault.Tier.Diamond, 200);

        usdc.mint(alice, 100_000e6);
        usdc.mint(address(vault), 1_000_000e6);

        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
    }

    function test_StakeFlexible_CreatesPosition() public {
        vm.prank(alice);
        uint256 positionId = vault.stake(address(usdc), 1_000e6, StakingVault.Tier.Flexible);

        (address posOwner,,, uint256 principal,, uint256 unlockTime,,,) = vault.positions(positionId);
        assertEq(posOwner, alice);
        assertEq(principal, 1_000e6);
        assertEq(unlockTime, 0);
    }

    function test_Withdraw_RevertsBeforeUnlock() public {
        vm.startPrank(alice);
        uint256 positionId = vault.stake(address(usdc), 1_000e6, StakingVault.Tier.Diamond);

        vm.expectRevert("Chua den han khoa, dung emergencyWithdraw");
        vault.withdraw(positionId);
        vm.stopPrank();
    }

    function test_Withdraw_SucceedsAfterUnlock() public {
        vm.startPrank(alice);
        uint256 positionId = vault.stake(address(usdc), 1_000e6, StakingVault.Tier.Growth);
        vm.stopPrank();

        vm.warp(block.timestamp + 181 days);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.withdraw(positionId);
        uint256 balAfter = usdc.balanceOf(alice);

        assertGt(balAfter, balBefore);
    }

    function test_EmergencyWithdraw_PenaltyBrackets() public {
        vm.prank(alice);
        uint256 pos1 = vault.stake(address(usdc), 1_000e6, StakingVault.Tier.Diamond);
        vm.warp(block.timestamp + 30 days);

        vm.prank(alice);
        vault.emergencyWithdraw(pos1);
        assertGt(vault.pendingInsuranceFund(address(usdc)), 0);

        vm.prank(alice);
        uint256 pos2 = vault.stake(address(usdc), 1_000e6, StakingVault.Tier.Diamond);
        vm.warp(block.timestamp + 300 days);

        uint256 pending = vault.pendingReward(pos2);
        uint256 balBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        vault.emergencyWithdraw(pos2);

        uint256 balAfter = usdc.balanceOf(alice);
        uint256 rewardReceived = balAfter - balBefore - 1_000e6;

        assertApproxEqRel(rewardReceived, pending * 75 / 100, 0.01e18);
    }

    function test_EmergencyWithdraw_AlwaysReturnsFullPrincipal() public {
        vm.prank(alice);
        uint256 positionId = vault.stake(address(usdc), 1_000e6, StakingVault.Tier.Diamond);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.emergencyWithdraw(positionId);
        uint256 balAfter = usdc.balanceOf(alice);

        assertEq(balAfter - balBefore, 1_000e6);
    }

    function test_InsuranceFund_TracksPerAssetSeparately() public {
        MockERC20 eurc = new MockERC20("Euro Coin", "EURC", 6);
        vault.setSupportedAsset(address(eurc), true);
        vault.setRewardRatePerSecond(address(eurc), REWARD_RATE);
        eurc.mint(alice, 100_000e6);
        eurc.mint(address(vault), 1_000_000e6);

        vm.startPrank(alice);
        eurc.approve(address(vault), type(uint256).max);
        uint256 posUsdc = vault.stake(address(usdc), 1_000e6, StakingVault.Tier.Diamond);
        uint256 posEurc = vault.stake(address(eurc), 1_000e6, StakingVault.Tier.Diamond);
        vm.stopPrank();

        vm.warp(block.timestamp + 30 days);

        vm.startPrank(alice);
        vault.emergencyWithdraw(posUsdc);
        vault.emergencyWithdraw(posEurc);
        vm.stopPrank();

        assertGt(vault.pendingInsuranceFund(address(usdc)), 0);
        assertGt(vault.pendingInsuranceFund(address(eurc)), 0);
    }
}
