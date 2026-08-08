// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IOracleV2} from "../interfaces/IOracleV2.sol";

/// @title OracleAdapterV2
/// @notice Owner-operated testnet price adapter with validation required by LendingPoolV2.
/// @dev This contract intentionally does not claim to be a decentralized production oracle.
///      It validates manual testnet prices while a production feed adapter is developed.
contract OracleAdapterV2 is IOracleV2, Ownable, Pausable {
    uint256 public constant MAX_PRICE_AGE = 1 hours;
    uint256 public constant MAX_DEVIATION_BPS = 2_000;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    mapping(address => uint256) public lastAcceptedPrice;
    mapping(address => uint256) public updatedAt;
    /// @notice Timestamp of the latest successful stateful validation.
    /// @dev Keeps getValidatedPrice intentionally non-view, matching IOracleV2.
    mapping(address => uint256) public lastValidatedAt;
    address[] private _configuredAssets;

    event PriceUpdated(address indexed asset, uint256 oldPrice, uint256 newPrice, uint256 timestamp);
    event OracleHealthChanged(address indexed asset, bool healthy);
    event OraclePauseStatusChanged(bool paused);

    error StalePrice();
    error PriceDeviationTooHigh();
    error OraclePaused();
    error ZeroPrice();
    error UnknownAsset();
    error ZeroAddress();

    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
    }

    /// @notice Records a validated manual price for a supported testnet asset.
    /// @dev A first non-zero price registers the asset. Subsequent updates are capped at 20%.
    function setPrice(address asset, uint256 priceWad) external onlyOwner {
        if (asset == address(0)) revert UnknownAsset();
        if (priceWad == 0) revert ZeroPrice();

        uint256 oldPrice = lastAcceptedPrice[asset];
        if (oldPrice != 0) {
            uint256 difference = priceWad > oldPrice ? priceWad - oldPrice : oldPrice - priceWad;
            uint256 maximumDifference = Math.mulDiv(oldPrice, MAX_DEVIATION_BPS, BPS_DENOMINATOR);
            if (difference > maximumDifference) revert PriceDeviationTooHigh();
        } else {
            _configuredAssets.push(asset);
        }

        lastAcceptedPrice[asset] = priceWad;
        updatedAt[asset] = block.timestamp;
        emit PriceUpdated(asset, oldPrice, priceWad, block.timestamp);
        emit OracleHealthChanged(asset, isHealthy(asset));
    }

    function pause() external onlyOwner {
        _pause();
        _emitGlobalHealth(false);
        emit OraclePauseStatusChanged(true);
    }

    function unpause() external onlyOwner {
        _unpause();
        for (uint256 i; i < _configuredAssets.length; ++i) {
            address asset = _configuredAssets[i];
            emit OracleHealthChanged(asset, isHealthy(asset));
        }
        emit OraclePauseStatusChanged(false);
    }

    /// @inheritdoc IOracleV2
    function getValidatedPrice(address asset) external override returns (uint256 priceWad, uint256 priceUpdatedAt) {
        _validate(asset);
        lastValidatedAt[asset] = block.timestamp;
        return (lastAcceptedPrice[asset], updatedAt[asset]);
    }

    /// @inheritdoc IOracleV2
    function isHealthy(address asset) public view override returns (bool) {
        if (paused() || lastAcceptedPrice[asset] == 0 || updatedAt[asset] == 0) return false;
        // Price freshness necessarily compares chain time with the owner-provided observation.
        // forge-lint: disable-next-line(block-timestamp)
        return block.timestamp - updatedAt[asset] <= MAX_PRICE_AGE;
    }

    function configuredAssets() external view returns (address[] memory) {
        return _configuredAssets;
    }

    function _validate(address asset) internal view {
        if (lastAcceptedPrice[asset] == 0 || updatedAt[asset] == 0) revert UnknownAsset();
        if (paused()) revert OraclePaused();
        // Price freshness necessarily compares chain time with the owner-provided observation.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp - updatedAt[asset] > MAX_PRICE_AGE) revert StalePrice();
    }

    function _emitGlobalHealth(bool healthy) internal {
        for (uint256 i; i < _configuredAssets.length; ++i) {
            emit OracleHealthChanged(_configuredAssets[i], healthy);
        }
    }
}
