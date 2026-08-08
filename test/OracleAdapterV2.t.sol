// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {OracleAdapterV2} from "../src/oracle/OracleAdapterV2.sol";

contract OracleAdapterV2Test is Test {
    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");
    address internal usdc = makeAddr("usdc");
    address internal eurc = makeAddr("eurc");
    address internal thirdAsset = makeAddr("thirdAsset");

    OracleAdapterV2 internal oracle;

    function setUp() public {
        oracle = new OracleAdapterV2(owner);
    }

    function test_FirstPriceRegistersAssetAndReturnsValidatedValue() public {
        vm.expectEmit(true, false, false, true, address(oracle));
        emit OracleAdapterV2.PriceUpdated(eurc, 0, 1.08e18, block.timestamp);
        vm.prank(owner);
        oracle.setPrice(eurc, 1.08e18);

        (uint256 priceWad, uint256 priceUpdatedAt) = oracle.getValidatedPrice(eurc);
        assertEq(priceWad, 1.08e18);
        assertEq(priceUpdatedAt, block.timestamp);
        assertTrue(oracle.isHealthy(eurc));
    }

    function test_RevertsForUnknownOrZeroPrice() public {
        vm.expectRevert(OracleAdapterV2.UnknownAsset.selector);
        oracle.getValidatedPrice(eurc);

        vm.prank(owner);
        vm.expectRevert(OracleAdapterV2.ZeroPrice.selector);
        oracle.setPrice(eurc, 0);
    }

    function test_StalePriceIsUnhealthyAndCannotBeRead() public {
        _setPrice(eurc, 1.08e18);
        vm.warp(block.timestamp + oracle.MAX_PRICE_AGE() + 1);

        assertFalse(oracle.isHealthy(eurc));
        vm.expectRevert(OracleAdapterV2.StalePrice.selector);
        oracle.getValidatedPrice(eurc);
    }

    function test_DeviationAtCapAllowedAboveCapReverts() public {
        _setPrice(eurc, 1e18);
        _setPrice(eurc, 1.2e18);

        vm.prank(owner);
        vm.expectRevert(OracleAdapterV2.PriceDeviationTooHigh.selector);
        oracle.setPrice(eurc, 1.440000000000000001e18);
    }

    function test_PauseMakesEveryConfiguredAssetUnhealthy() public {
        _setPrice(usdc, 1e18);
        _setPrice(eurc, 1.08e18);
        vm.prank(owner);
        oracle.pause();

        assertFalse(oracle.isHealthy(usdc));
        assertFalse(oracle.isHealthy(eurc));
        vm.expectRevert(OracleAdapterV2.OraclePaused.selector);
        oracle.getValidatedPrice(eurc);

        vm.prank(owner);
        oracle.unpause();
        assertTrue(oracle.isHealthy(usdc));
        assertTrue(oracle.isHealthy(eurc));
    }

    function test_MultiAssetPricesAreIndependent() public {
        _setPrice(usdc, 1e18);
        _setPrice(eurc, 1.08e18);
        _setPrice(thirdAsset, 2.5e18);
        _setPrice(eurc, 1.15e18);

        assertEq(oracle.lastAcceptedPrice(usdc), 1e18);
        assertEq(oracle.lastAcceptedPrice(eurc), 1.15e18);
        assertEq(oracle.lastAcceptedPrice(thirdAsset), 2.5e18);
        assertEq(oracle.configuredAssets().length, 3);
    }

    function test_OnlyOwnerCanOperateOracle() public {
        vm.prank(stranger);
        vm.expectRevert();
        oracle.setPrice(eurc, 1.08e18);

        vm.prank(stranger);
        vm.expectRevert();
        oracle.pause();
    }

    function _setPrice(address asset, uint256 priceWad) internal {
        vm.prank(owner);
        oracle.setPrice(asset, priceWad);
    }
}
