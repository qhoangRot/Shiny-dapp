// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IOracleV2} from "../../src/interfaces/IOracleV2.sol";
import {IRevenueRouterV2} from "../../src/interfaces/IRevenueRouterV2.sol";
import {IInsuranceFundV2} from "../../src/interfaces/IInsuranceFundV2.sol";
import {IStakingVaultV2} from "../../src/interfaces/IStakingVaultV2.sol";

interface IRewardNotifierV2 {
    function notifyReward(address asset, uint256 amount) external;
}

contract MockOracleV2 is IOracleV2 {
    struct PriceData {
        uint256 priceWad;
        uint256 updatedAt;
        bool healthy;
    }

    mapping(address => PriceData) public prices;

    function setPrice(address asset, uint256 priceWad) external {
        prices[asset].priceWad = priceWad;
        prices[asset].updatedAt = block.timestamp;
    }

    function setHealthy(address asset, bool healthy) external {
        prices[asset].healthy = healthy;
    }

    function getValidatedPrice(address asset) external view returns (uint256 priceWad, uint256 updatedAt) {
        PriceData storage data = prices[asset];
        require(data.healthy && data.priceWad != 0 && data.updatedAt != 0, "UNHEALTHY_PRICE");
        return (data.priceWad, data.updatedAt);
    }

    function isHealthy(address asset) external view returns (bool) {
        PriceData storage data = prices[asset];
        return data.healthy && data.priceWad != 0 && data.updatedAt != 0;
    }
}

contract MockRevenueRouterV2 is IRevenueRouterV2 {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public routed;

    function routeRevenue(address asset, uint256 amount)
        external
        returns (uint256 stakerAmount, uint256 treasuryAmount, uint256 insuranceAmount, uint256 creditAmount)
    {
        routed[asset] += amount;
        stakerAmount = amount * 65 / 100;
        treasuryAmount = amount * 15 / 100;
        insuranceAmount = amount * 10 / 100;
        creditAmount = amount - stakerAmount - treasuryAmount - insuranceAmount;
        emit RevenueSettled(asset, amount, stakerAmount, treasuryAmount, insuranceAmount, creditAmount);
    }

    function fundAndNotify(address vault, address asset, uint256 amount) external {
        IERC20(asset).safeTransferFrom(msg.sender, vault, amount);
        IRewardNotifierV2(vault).notifyReward(asset, amount);
    }
}

contract MockInsuranceFundV2 is IInsuranceFundV2 {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public override totalInsuranceFromForfeiture;
    mapping(address => uint256) public override totalInsuranceFromRevenue;
    mapping(address => uint256) public override totalInsuranceUsedForBadDebt;

    function availableInsurance(address asset) external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    function coverDeficit(address asset, uint256 requested, address recipient) external {
        if (IERC20(asset).balanceOf(address(this)) < requested) revert InsufficientInsuranceBalance();
        totalInsuranceUsedForBadDebt[asset] += requested;
        IERC20(asset).safeTransfer(recipient, requested);
        emit DeficitCovered(asset, recipient, requested);
    }

    function notifyForfeiture(address asset, uint256 amount) external {
        totalInsuranceFromForfeiture[asset] += amount;
        emit ForfeitureReceived(asset, amount);
    }

    function notifyRevenueContribution(address asset, uint256 amount) external {
        totalInsuranceFromRevenue[asset] += amount;
        emit RevenueContributionReceived(asset, amount);
    }
}

    contract ReentrantMockERC20 is ERC20 {
        uint8 private immutable _tokenDecimals;
        address public callbackTarget;
        bytes public callbackData;
        bool public callbackOnTransferFrom;
        bool public callbackOnTransfer;
        bool public callbackAttempted;
        bool public callbackSucceeded;

        constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
            _tokenDecimals = decimals_;
        }

        function decimals() public view override returns (uint8) {
            return _tokenDecimals;
        }

        function mint(address to, uint256 amount) external {
            _mint(to, amount);
        }

        function armCallback(address target, bytes calldata data, bool onTransferFrom, bool onTransfer) external {
            callbackTarget = target;
            callbackData = data;
            callbackOnTransferFrom = onTransferFrom;
            callbackOnTransfer = onTransfer;
            callbackAttempted = false;
            callbackSucceeded = false;
        }

        function transferFrom(address from, address to, uint256 value) public override returns (bool) {
            if (callbackOnTransferFrom) _attemptCallback();
            return super.transferFrom(from, to, value);
        }

        function transfer(address to, uint256 value) public override returns (bool) {
            if (callbackOnTransfer) _attemptCallback();
            return super.transfer(to, value);
        }

        function _attemptCallback() internal {
            callbackOnTransferFrom = false;
            callbackOnTransfer = false;
            callbackAttempted = true;
            (callbackSucceeded,) = callbackTarget.call(callbackData);
        }
    }

    contract MockStakingVaultV2 is IStakingVaultV2 {
        mapping(address => mapping(address => uint256)) public principal;
        mapping(address => uint256) public override accRewardPerWeightedShare;

        function setPrincipal(address user, address asset, uint256 amount) external {
            principal[user][asset] = amount;
        }

        function getSeizablePrincipal(address user, address asset, uint256[] calldata) external view returns (uint256) {
            return principal[user][asset];
        }

        function getTotalSeizablePrincipal(address user, address asset) external view returns (uint256) {
            return principal[user][asset];
        }

        function seizeStakedCollateral(address user, address asset, uint256[] calldata, uint256 amount, address)
            external
            returns (uint256)
        {
            principal[user][asset] -= amount;
            return amount;
        }

        function tierWeight(uint8) external pure returns (uint256) {
            return 1e18;
        }
    }

        contract ReentrantInsuranceFundV2 is IInsuranceFundV2 {
            using SafeERC20 for IERC20;

            address public callbackTarget;
            bytes public callbackData;
            bool public callbackAttempted;
            bool public callbackSucceeded;

            mapping(address => uint256) public override totalInsuranceFromForfeiture;
            mapping(address => uint256) public override totalInsuranceFromRevenue;
            mapping(address => uint256) public override totalInsuranceUsedForBadDebt;

            function armCallback(address target, bytes calldata data) external {
                callbackTarget = target;
                callbackData = data;
                callbackAttempted = false;
                callbackSucceeded = false;
            }

            function availableInsurance(address asset) external view returns (uint256) {
                return IERC20(asset).balanceOf(address(this));
            }

            function coverDeficit(address asset, uint256 requested, address recipient) external {
                callbackAttempted = true;
                (callbackSucceeded,) = callbackTarget.call(callbackData);
                totalInsuranceUsedForBadDebt[asset] += requested;
                IERC20(asset).safeTransfer(recipient, requested);
            }

            function notifyForfeiture(address asset, uint256 amount) external {
                totalInsuranceFromForfeiture[asset] += amount;
            }

            function notifyRevenueContribution(address asset, uint256 amount) external {
                totalInsuranceFromRevenue[asset] += amount;
            }
        }
