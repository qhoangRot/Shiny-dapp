// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/RewardDistributor.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Deploys RewardDistributor without changing the current StakingVault.
///
/// Default behavior is deploy-only. To also create and fund the first USDC and
/// EURC programs, the operator must explicitly set:
///
/// CONFIGURE_REWARD_PROGRAMS=true
/// USDC_ADDRESS=<token>
/// EURC_ADDRESS=<token>
/// REWARD_PROGRAM_START=<future unix timestamp>
/// REWARD_PROGRAM_END=<later unix timestamp>
/// FLEXIBLE_ANNUAL_BPS=<e.g. 500 for 5.00%>
/// GROWTH_ANNUAL_BPS=<e.g. 600 for 6.00%>
/// DIAMOND_ANNUAL_BPS=<e.g. 700 for 7.00%>
/// USDC_REWARD_FUNDING_UNITS=<raw 6-decimal token units>
/// EURC_REWARD_FUNDING_UNITS=<raw 6-decimal token units>
///
/// PRIVATE_KEY and STAKING_VAULT_ADDRESS are always required.
contract DeployRewardDistributor is Script {
    using SafeERC20 for IERC20;

    function run() external returns (RewardDistributor distributor) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address stakingVaultAddress = vm.envAddress("STAKING_VAULT_ADDRESS");
        address deployer = vm.addr(deployerPrivateKey);
        bool configurePrograms = vm.envOr("CONFIGURE_REWARD_PROGRAMS", false);

        vm.startBroadcast(deployerPrivateKey);

        distributor = new RewardDistributor(deployer, stakingVaultAddress);

        if (configurePrograms) {
            _configureAndFundPrograms(distributor);
        }

        vm.stopBroadcast();

        console.log("RewardDistributor deployed at:", address(distributor));
        console.log("StakingVault (read-only source):", stakingVaultAddress);
        console.log("Owner:", deployer);
        console.log("Programs configured:", configurePrograms);
    }

    function _configureAndFundPrograms(RewardDistributor distributor) internal {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address eurc = vm.envAddress("EURC_ADDRESS");
        uint64 startTime = _toUint64(vm.envUint("REWARD_PROGRAM_START"));
        uint64 endTime = _toUint64(vm.envUint("REWARD_PROGRAM_END"));
        uint32 flexibleAnnualBps = _toUint32(vm.envUint("FLEXIBLE_ANNUAL_BPS"));
        uint32 growthAnnualBps = _toUint32(vm.envUint("GROWTH_ANNUAL_BPS"));
        uint32 diamondAnnualBps = _toUint32(vm.envUint("DIAMOND_ANNUAL_BPS"));
        uint256 usdcFunding = vm.envUint("USDC_REWARD_FUNDING_UNITS");
        uint256 eurcFunding = vm.envUint("EURC_REWARD_FUNDING_UNITS");

        require(usdcFunding > 0, "USDC reward funding must be explicit and non-zero");
        require(eurcFunding > 0, "EURC reward funding must be explicit and non-zero");

        uint256 usdcProgramId = distributor.createProgram(
            usdc,
            startTime,
            endTime,
            flexibleAnnualBps,
            growthAnnualBps,
            diamondAnnualBps
        );
        uint256 eurcProgramId = distributor.createProgram(
            eurc,
            startTime,
            endTime,
            flexibleAnnualBps,
            growthAnnualBps,
            diamondAnnualBps
        );

        IERC20(usdc).forceApprove(address(distributor), usdcFunding);
        distributor.fundProgram(usdcProgramId, usdcFunding);
        IERC20(eurc).forceApprove(address(distributor), eurcFunding);
        distributor.fundProgram(eurcProgramId, eurcFunding);

        console.log("USDC reward program:", usdcProgramId);
        console.log("EURC reward program:", eurcProgramId);
        console.log("USDC reward reserve funded:", usdcFunding);
        console.log("EURC reward reserve funded:", eurcFunding);
    }

    function _toUint64(uint256 value) internal pure returns (uint64) {
        require(value <= type(uint64).max, "Value does not fit uint64");
        return uint64(value);
    }

    function _toUint32(uint256 value) internal pure returns (uint32) {
        require(value <= type(uint32).max, "Value does not fit uint32");
        return uint32(value);
    }
}
