// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/LendingPool.sol";
import "../src/StakingVault.sol";
import "../src/oracle/ManualTestnetOracle.sol";

/// @notice Deploys the Arc Testnet-only manual FX oracle and a fresh LendingPool.
contract DeployManualTestnetLending is Script {
    uint256 internal constant INITIAL_EUR_USD_PRICE = 1.08e18;
    uint256 internal constant INITIAL_USDC_LIQUIDITY = 50e6;
    uint256 internal constant INITIAL_EURC_LIQUIDITY = 50e6;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address eurc = vm.envAddress("EURC_ADDRESS");
        address vaultAddress = vm.envAddress("STAKING_VAULT_ADDRESS");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        ManualTestnetOracle oracle = new ManualTestnetOracle(deployer, INITIAL_EUR_USD_PRICE);
        LendingPool pool = new LendingPool(deployer, usdc, eurc, address(oracle));

        StakingVault(vaultAddress).setLendingPool(address(pool));
        pool.setStakingVault(vaultAddress);

        IERC20(usdc).transfer(address(pool), INITIAL_USDC_LIQUIDITY);
        IERC20(eurc).transfer(address(pool), INITIAL_EURC_LIQUIDITY);

        vm.stopBroadcast();

        console.log("ManualTestnetOracle deployed at:", address(oracle));
        console.log("LendingPool deployed at:", address(pool));
        console.log("EUR/USD simulated price:", INITIAL_EUR_USD_PRICE);
    }
}
