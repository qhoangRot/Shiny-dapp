// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LendingPoolV2} from "../src/LendingPoolV2.sol";
import {StakingVaultV2} from "../src/StakingVaultV2.sol";
import {OracleAdapterV2} from "../src/oracle/OracleAdapterV2.sol";
import {ILendingPoolV2} from "../src/interfaces/ILendingPoolV2.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockRevenueRouterV2, MockInsuranceFundV2} from "./mocks/V2Mocks.sol";

contract OracleAdapterV2IntegrationTest is Test {
    uint256 internal constant UNIT = 1e6;
    address internal alice = makeAddr("alice");

    MockERC20 internal usdc;
    MockERC20 internal eurc;
    OracleAdapterV2 internal oracle;
    StakingVaultV2 internal vault;
    LendingPoolV2 internal pool;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        oracle = new OracleAdapterV2(address(this));
        vault = new StakingVaultV2(address(this), address(usdc), address(eurc));
        pool = new LendingPoolV2(
            address(this),
            address(usdc),
            address(eurc),
            address(vault),
            address(oracle),
            address(new MockRevenueRouterV2()),
            address(new MockInsuranceFundV2())
        );
        vault.setLendingPool(address(pool));
        vault.setRevenueRouter(address(this));
        oracle.setPrice(address(usdc), 1e18);
        oracle.setPrice(address(eurc), 1.08e18);

        usdc.mint(alice, 1_000 * UNIT);
        eurc.mint(address(this), 10_000 * UNIT);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        pool.fundLiquidity(address(eurc), 10_000 * UNIT);
    }

    function test_LendingPoolUsesValidatedManualOracle() public {
        vm.prank(alice);
        vault.stake(address(usdc), 1_000 * UNIT, StakingVaultV2.Tier.Flexible);

        vm.prank(alice);
        pool.borrow(address(usdc), address(eurc), 500 * UNIT);

        vm.prank(address(this));
        oracle.pause();
        vm.prank(alice);
        vm.expectRevert(ILendingPoolV2.DebtAssetSuspended.selector);
        pool.borrow(address(usdc), address(eurc), 1 * UNIT);
    }
}
