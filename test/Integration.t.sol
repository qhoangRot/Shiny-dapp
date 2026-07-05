// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/StakingVault.sol";
import "../src/LendingPool.sol";
import "../src/oracle/PriceOracle.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockStork.sol";

/// @title Test tich hop: Stake + Borrow-While-Staking (khong can rut stake ra de vay)
contract IntegrationTest is Test {
    StakingVault public vault;
    LendingPool public pool;
    PriceOracle public oracle;
    MockStork public stork;
    MockERC20 public usdc;
    MockERC20 public eurc;

    address public owner = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    bytes32 public constant FEED_ID = keccak256("EURCUSD");

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        stork = new MockStork();
        stork.setPrice(FEED_ID, 1.08e18);

        oracle = new PriceOracle(owner, address(stork), FEED_ID);
        vault = new StakingVault(owner);
        pool = new LendingPool(owner, address(usdc), address(eurc), address(oracle));

        // Noi 2 contract lai voi nhau
        vault.setLendingPool(address(pool));
        pool.setStakingVault(address(vault));

        vault.setSupportedAsset(address(usdc), true);
        vault.setRewardRatePerSecond(address(usdc), 0); // tat reward de test HF khong bi nhieu

        pool.setBorrowRatePerSecond(address(eurc), 0);

        usdc.mint(alice, 100_000e6);
        eurc.mint(address(pool), 1_000_000e6);
        eurc.mint(bob, 100_000e6);

        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);

        vm.prank(bob);
        eurc.approve(address(pool), type(uint256).max);
    }

    /// @dev Test quan trong nhat: Alice stake USDC, sau do VAY EURC ma KHONG can rut stake ra
    function test_BorrowWhileStaking_WithoutUnstaking() public {
        vm.startPrank(alice);
        vault.stake(address(usdc), 1_000e6, StakingVault.Tier.Flexible);

        // Alice CHUA deposit collateral rieng nao vao LendingPool,
        // nhung van vay duoc EURC nho vao vi tri dang stake
        pool.borrow(address(eurc), 500e6);
        vm.stopPrank();

        (uint256 principal,,, bool active) = pool.loans(alice, address(eurc));
        assertEq(principal, 500e6);
        assertTrue(active);

        // Xac nhan Alice van con nguyen vi tri stake, khong bi rut
        (,,, uint256 stakedPrincipal,,,,, bool withdrawn) = vault.positions(1);
        assertEq(stakedPrincipal, 1_000e6);
        assertFalse(withdrawn);
    }

    /// @dev Neu rut stake se lam Health Factor mat an toan -> StakingVault phai TU CHOI rut
    function test_EmergencyWithdraw_BlockedWhenWouldBreakHealthFactor() public {
        vm.startPrank(alice);
        uint256 positionId = vault.stake(address(usdc), 1_000e6, StakingVault.Tier.Diamond);
        pool.borrow(address(eurc), 690e6); // vay gan sat Max LTV (75%)

        vm.expectRevert("LendingPool: rut se lam Health Factor mat an toan");
        vault.emergencyWithdraw(positionId);
        vm.stopPrank();
    }

    /// @dev Neu KHONG vay gi ca, rut stake van phai hoat dong binh thuong
    function test_EmergencyWithdraw_WorksNormally_WhenNoDebt() public {
        vm.startPrank(alice);
        uint256 positionId = vault.stake(address(usdc), 1_000e6, StakingVault.Tier.Diamond);
        vault.emergencyWithdraw(positionId); // khong vay gi, rut thoai mai
        vm.stopPrank();

        (,,,,,,,, bool withdrawn) = vault.positions(positionId);
        assertTrue(withdrawn);
    }

    /// @dev Sau khi tra het no, rut stake phai hoat dong lai binh thuong
    function test_EmergencyWithdraw_WorksAfterFullRepay() public {
        vm.startPrank(alice);
        uint256 positionId = vault.stake(address(usdc), 1_000e6, StakingVault.Tier.Diamond);
        pool.borrow(address(eurc), 690e6);

        eurc.mint(alice, 690e6);
        eurc.approve(address(pool), type(uint256).max);
        pool.repay(address(eurc), 690e6);

        vault.emergencyWithdraw(positionId); // gio da tra het no, rut duoc binh thuong
        vm.stopPrank();

        (,,,,,,,, bool withdrawn) = vault.positions(positionId);
        assertTrue(withdrawn);
    }
}
