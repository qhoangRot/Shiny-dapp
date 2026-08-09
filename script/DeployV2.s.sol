// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {StakingVaultV2} from "../src/StakingVaultV2.sol";
import {LendingPoolV2} from "../src/LendingPoolV2.sol";
import {RevenueRouterV2} from "../src/RevenueRouterV2.sol";
import {InsuranceFundV2} from "../src/InsuranceFundV2.sol";
import {OracleAdapterV2} from "../src/oracle/OracleAdapterV2.sol";

/// @title DeployV2
/// @notice Deploys and wires Shiny V2 in parallel with V1.
/// @dev This script deliberately has no V1 contract address inputs and never
///      calls V1. Existing V1 positions remain claimable/withdrawable/repayable.
///
/// Required environment:
/// PRIVATE_KEY, USDC_ADDRESS, EURC_ADDRESS, TREASURY_ADDRESS,
/// USDC_PRICE_WAD, EURC_PRICE_WAD
contract DeployV2 is Script {
    error DeploymentVerificationFailed();

    function run()
        external
        returns (
            StakingVaultV2 vault,
            OracleAdapterV2 oracle,
            RevenueRouterV2 router,
            InsuranceFundV2 insurance,
            LendingPoolV2 pool
        )
    {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address usdc = vm.envAddress("USDC_ADDRESS");
        address eurc = vm.envAddress("EURC_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 usdcPriceWad = vm.envUint("USDC_PRICE_WAD");
        uint256 eurcPriceWad = vm.envUint("EURC_PRICE_WAD");

        vm.startBroadcast(deployerPrivateKey);

        vault = new StakingVaultV2(deployer, usdc, eurc);
        oracle = new OracleAdapterV2(deployer);
        insurance = new InsuranceFundV2(deployer);
        // Router depends on both the Vault and Insurance Fund at construction.
        router = new RevenueRouterV2(deployer, address(vault), address(insurance), treasury);
        pool = new LendingPoolV2(
            deployer, usdc, eurc, address(vault), address(oracle), address(router), address(insurance)
        );

        vault.setLendingPool(address(pool));
        vault.setRevenueRouter(address(router));
        vault.setInsuranceFund(address(insurance));
        router.setLendingPool(address(pool));
        insurance.setLendingPool(address(pool));
        insurance.setRevenueRouter(address(router));
        insurance.setStakingVault(address(vault));

        // No price is hardcoded: the testnet operator explicitly supplies both values.
        oracle.setPrice(usdc, usdcPriceWad);
        oracle.setPrice(eurc, eurcPriceWad);

        vm.stopBroadcast();

        _verify(vault, oracle, router, insurance, pool, usdc, eurc);
        _logDeployment(vault, oracle, router, insurance, pool);
    }

    function _verify(
        StakingVaultV2 vault,
        OracleAdapterV2 oracle,
        RevenueRouterV2 router,
        InsuranceFundV2 insurance,
        LendingPoolV2 pool,
        address usdc,
        address eurc
    ) internal view {
        if (
            vault.lendingPool() != address(pool) || vault.revenueRouter() != address(router)
                || vault.insuranceFund() != address(insurance) || router.lendingPool() != address(pool)
                || insurance.lendingPool() != address(pool) || insurance.revenueRouter() != address(router)
                || insurance.stakingVault() != address(vault) || !oracle.isHealthy(usdc) || !oracle.isHealthy(eurc)
        ) revert DeploymentVerificationFailed();
    }

    function _logDeployment(
        StakingVaultV2 vault,
        OracleAdapterV2 oracle,
        RevenueRouterV2 router,
        InsuranceFundV2 insurance,
        LendingPoolV2 pool
    ) internal pure {
        console2.log("Shiny V2 StakingVault:", address(vault));
        console2.log("Shiny V2 OracleAdapter:", address(oracle));
        console2.log("Shiny V2 RevenueRouter:", address(router));
        console2.log("Shiny V2 InsuranceFund:", address(insurance));
        console2.log("Shiny V2 LendingPool:", address(pool));
    }
}
