// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/oracle/ManualTestnetOracle.sol";

contract ManualTestnetOracleTest is Test {
    ManualTestnetOracle internal oracle;
    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        oracle = new ManualTestnetOracle(owner, 1.08e18);
    }

    function testInitialPrice() public view {
        (uint256 price, uint256 timestamp) = oracle.viewPrice();
        assertEq(price, 1.08e18);
        assertEq(timestamp, block.timestamp);
    }

    function testOwnerCanUpdatePrice() public {
        vm.prank(owner);
        oracle.setPrice(1.1e18);

        (uint256 price,) = oracle.viewPrice();
        assertEq(price, 1.1e18);
    }

    function testRejectsPriceOutsideTestRange() public {
        vm.prank(owner);
        vm.expectRevert("ManualOracle: price outside EUR/USD test range");
        oracle.setPrice(1.6e18);
    }

    function testRejectsUnauthorizedUpdate() public {
        vm.prank(stranger);
        vm.expectRevert();
        oracle.setPrice(1.1e18);
    }

    function testRejectsStalePrice() public {
        vm.warp(block.timestamp + 30 days + 1);
        vm.expectRevert("ManualOracle: stale price");
        oracle.getPrice();
    }
}
