// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/LendingPool.sol";
import "../src/oracle/PriceOracle.sol";

contract DeployLending is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address eurc = vm.envAddress("EURC_ADDRESS");
        address storkAddress = vm.envAddress("STORK_ORACLE_ADDRESS");
        bytes32 feedId = vm.envBytes32("STORK_FEED_ID");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        PriceOracle oracle = new PriceOracle(deployer, storkAddress, feedId);
        LendingPool pool = new LendingPool(deployer, usdc, eurc, address(oracle));

        vm.stopBroadcast();

        console.log("PriceOracle deployed at:", address(oracle));
        console.log("LendingPool deployed at:", address(pool));
    }
}
