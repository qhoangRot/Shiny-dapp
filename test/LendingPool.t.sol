// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/LendingPool.sol";
import "../src/oracle/PriceOracle.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockStork.sol";

contract LendingPoolTest is Test {
    LendingPool public pool;
    PriceOracle public oracle;
    MockStork public stork;
    MockERC20 public usdc;
    MockERC20 public eurc;

    address public owner = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B); // dong vai lien doi hanh dong thanh ly

    bytes32 public constant FEED_ID = keccak256("EURCUSD");

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        stork = new MockStork();

        // Gia khoi diem: 1 EURC = 1.08 USD
        stork.setPrice(FEED_ID, 1.08e18);

        oracle = new PriceOracle(owner, address(stork), FEED_ID);
        pool = new LendingPool(owner, address(usdc), address(eurc), address(oracle));

        pool.setBorrowRatePerSecond(address(usdc), 0); // tat lai suat de test HF khong bi nhieu boi thoi gian
        pool.setBorrowRatePerSecond(address(eurc), 0);

        // Cap von: Alice co the chap USDC va vay EURC. Pool phai co san EURC de cho vay.
        usdc.mint(alice, 100_000e6);
        eurc.mint(address(pool), 1_000_000e6);
        eurc.mint(bob, 100_000e6); // Bob dung de tra no thay khi thanh ly

        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);

        vm.prank(bob);
        eurc.approve(address(pool), type(uint256).max);
    }

    function test_DepositCollateral_Success() public {
        vm.prank(alice);
        pool.depositCollateral(address(usdc), 1_000e6);

        assertEq(pool.collateralBalance(alice, address(usdc)), 1_000e6);
    }

    function test_Borrow_WithinLimit_Success() public {
        vm.startPrank(alice);
        pool.depositCollateral(address(usdc), 1_000e6); // the chap 1000 USDC (~925.9 EURC)
        pool.borrow(address(eurc), 500e6); // vay 500 EURC, LTV thap, an toan
        vm.stopPrank();

        (uint256 principal,,, bool active) = pool.loans(alice, address(eurc));
        assertEq(principal, 500e6);
        assertTrue(active);
    }

    function test_Borrow_ExceedsHealthFactor_Reverts() public {
        vm.startPrank(alice);
        pool.depositCollateral(address(usdc), 1_000e6);

        // 1000 USDC ~ 925.9 EURC. Vay 900 EURC se vuot qua nguong an toan (Max LTV 75%)
        vm.expectRevert("Vay vuot qua Max LTV cho phep");
        pool.borrow(address(eurc), 900e6);
        vm.stopPrank();
    }

    function test_Repay_ReducesDebt() public {
        vm.startPrank(alice);
        pool.depositCollateral(address(usdc), 1_000e6);
        pool.borrow(address(eurc), 500e6);

        eurc.mint(alice, 500e6); // gia lap Alice co san EURC de tra no
        eurc.approve(address(pool), type(uint256).max);
        pool.repay(address(eurc), 500e6);
        vm.stopPrank();

        (uint256 principal,,, bool active) = pool.loans(alice, address(eurc));
        assertEq(principal, 0);
        assertFalse(active);
    }

    /// @dev Test quan trong nhat: thanh ly PHAI hoat dong khi gia bien dong lam HF < 1.0
    function test_Liquidate_WhenHealthFactorBelowOne() public {
        vm.startPrank(alice);
        pool.depositCollateral(address(usdc), 1_000e6);
        pool.borrow(address(eurc), 690e6); // gan sat Max LTV 75% luc dau (LTV ~74.5%)
        vm.stopPrank();

        // Gia EURC tang tu 1.08 USD len 1.22 USD (+12.96%, van trong nguong circuit breaker 20%)
        // -> no cua Alice (tinh theo USDC) tang len, khien Health Factor tut xuong duoi 1.0
        stork.setPrice(FEED_ID, 1.22e18);

        uint256 hf = pool.getHealthFactor(alice);
        assertLt(hf, 1e18); // xac nhan HF thuc su da mat an toan truoc khi thanh ly

        uint256 aliceCollateralBefore = pool.collateralBalance(alice, address(usdc));

        vm.prank(bob);
        pool.liquidate(alice, address(eurc), 690e6); // Bob tra no thay Alice, nhan thuong bang USDC

        uint256 aliceCollateralAfter = pool.collateralBalance(alice, address(usdc));
        assertLt(aliceCollateralAfter, aliceCollateralBefore); // collateral cua Alice bi tru bot

        (uint256 principal,,, bool active) = pool.loans(alice, address(eurc));
        assertEq(principal, 0); // no da duoc tra het
        assertFalse(active);

        assertGt(usdc.balanceOf(bob), 0); // Bob nhan duoc USDC (collateral + thuong 5%)
    }

    function test_Liquidate_RevertsWhenPositionSafe() public {
        vm.startPrank(alice);
        pool.depositCollateral(address(usdc), 1_000e6);
        pool.borrow(address(eurc), 100e6); // vay it, rat an toan
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert("Vi tri van an toan, chua the thanh ly");
        pool.liquidate(alice, address(eurc), 100e6);
    }
}
