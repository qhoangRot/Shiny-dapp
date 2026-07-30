// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IPriceOracle.sol";

/// @title ManualTestnetOracle
/// @notice Owner-maintained EUR/USD price for Arc Testnet only.
/// @dev This is deliberately not presented as a decentralized or production oracle.
contract ManualTestnetOracle is Ownable, IPriceOracle {
    uint256 public constant MIN_EUR_USD_PRICE = 0.8e18;
    uint256 public constant MAX_EUR_USD_PRICE = 1.5e18;

    uint256 public price;
    uint256 public updatedAt;
    uint256 public maxStaleness = 30 days;
    bool public paused;

    event ManualPriceUpdated(uint256 price, uint256 timestamp);
    event MaxStalenessUpdated(uint256 maxStaleness);
    event OraclePaused(bool paused);

    constructor(address initialOwner, uint256 initialPrice) Ownable(initialOwner) {
        _setPrice(initialPrice);
    }

    function setPrice(uint256 newPrice) external onlyOwner {
        _setPrice(newPrice);
    }

    function setMaxStaleness(uint256 newMaxStaleness) external onlyOwner {
        require(newMaxStaleness >= 1 hours && newMaxStaleness <= 90 days, "ManualOracle: invalid staleness");
        maxStaleness = newMaxStaleness;
        emit MaxStalenessUpdated(newMaxStaleness);
    }

    function setPaused(bool status) external onlyOwner {
        paused = status;
        emit OraclePaused(status);
    }

    function getPrice() external view override returns (uint256) {
        _validate();
        return price;
    }

    function viewPrice() external view override returns (uint256, uint256) {
        _validate();
        return (price, updatedAt);
    }

    function _setPrice(uint256 newPrice) internal {
        require(
            newPrice >= MIN_EUR_USD_PRICE && newPrice <= MAX_EUR_USD_PRICE,
            "ManualOracle: price outside EUR/USD test range"
        );
        price = newPrice;
        updatedAt = block.timestamp;
        emit ManualPriceUpdated(newPrice, block.timestamp);
    }

    function _validate() internal view {
        require(!paused, "ManualOracle: paused");
        require(block.timestamp - updatedAt <= maxStaleness, "ManualOracle: stale price");
    }
}
