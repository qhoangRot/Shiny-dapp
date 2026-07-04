// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/StakingVault.sol";

contract DeployStakingVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address eurc = vm.envAddress("EURC_ADDRESS");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        StakingVault vault = new StakingVault(deployer);

        // Kich hoat 2 asset duoc ho tro ngay sau khi deploy
        vault.setSupportedAsset(usdc, true);
        vault.setSupportedAsset(eurc, true);

        vm.stopBroadcast();

        console.log("StakingVault deployed at:", address(vault));
        console.log("Owner:", deployer);
    }
}
