// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/StakingVault.sol";
import "../src/LendingPool.sol";
import "../src/oracle/PriceOracle.sol";

/// @notice Deploy toan bo 3 contract cot loi cua Shiny Protocol, tu dong noi chung lai voi nhau
contract DeployAll is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address eurc = vm.envAddress("EURC_ADDRESS");
        address storkAddress = vm.envAddress("STORK_ORACLE_ADDRESS");
        bytes32 feedId = vm.envBytes32("STORK_FEED_ID");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy PriceOracle
        PriceOracle oracle = new PriceOracle(deployer, storkAddress, feedId);

        // 2. Deploy StakingVault
        StakingVault vault = new StakingVault(deployer);
        vault.setSupportedAsset(usdc, true);
        vault.setSupportedAsset(eurc, true);

        // 3. Deploy LendingPool
        LendingPool pool = new LendingPool(deployer, usdc, eurc, address(oracle));

        // 4. Noi 2 contract lai voi nhau (Borrow-While-Staking)
        vault.setLendingPool(address(pool));
        pool.setStakingVault(address(vault));

        vm.stopBroadcast();

        console.log("PriceOracle deployed at:", address(oracle));
        console.log("StakingVault deployed at:", address(vault));
        console.log("LendingPool deployed at:", address(pool));
    }
}
