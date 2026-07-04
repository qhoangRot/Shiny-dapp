// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Interface toi thieu cua Stork Oracle (da xac nhan tu docs.stork.network)
interface IStork {
    struct TemporalNumericValue {
        uint64 timestampNs;   // timestamp nano-giay
        int192 quantizedValue; // gia, luon scale 1e18
    }
    function getTemporalNumericValueUnsafeV1(bytes32 id) external view returns (TemporalNumericValue memory value);
}

/// @title PriceOracle - Lop bao ve quanh Stork Oracle cho Shiny Protocol
/// @notice Tu trien khai circuit breaker: tu choi gia stale hoac lech qua nguong (theo spec muc 5)
contract PriceOracle is Ownable {
    IStork public stork;
    bytes32 public feedId; // Feed ID cho cap EURC/USD tren Stork asset registry

    uint256 public maxStaleness = 300;      // 5 phut (giay) - gia qua thoi han nay bi tu choi
    uint256 public maxDeviationBps = 2000;  // 20% - dung theo spec circuit breaker
    uint256 public constant BPS_DENOMINATOR = 10_000;

    uint256 public lastAcceptedPrice; // scale 1e18
    uint256 public lastAcceptedAt;
    bool public paused;

    event FeedIdUpdated(bytes32 newFeedId);
    event PriceAccepted(uint256 price, uint256 timestamp);
    event CircuitBreakerToggled(bool status);

    constructor(address initialOwner, address storkAddress, bytes32 initialFeedId) Ownable(initialOwner) {
        stork = IStork(storkAddress);
        feedId = initialFeedId;
    }

    function setFeedId(bytes32 newFeedId) external onlyOwner {
        feedId = newFeedId;
        emit FeedIdUpdated(newFeedId);
    }

    function setMaxStaleness(uint256 secondsAllowed) external onlyOwner {
        maxStaleness = secondsAllowed;
    }

    function setMaxDeviationBps(uint256 bps) external onlyOwner {
        maxDeviationBps = bps;
    }

    /// @notice Admin co the tam dung oracle thu cong neu phat hien bat thuong
    function setPaused(bool status) external onlyOwner {
        paused = status;
        emit CircuitBreakerToggled(status);
    }

    /// @notice Lay gia EURC/USD, da qua kiem tra staleness + deviation.
    ///         Se revert neu gia khong hop le -> Borrow/Liquidation tu dong dung (dung theo spec).
    function getPrice() public returns (uint256 price) {
        require(!paused, "Oracle: dang tam dung boi circuit breaker");

        IStork.TemporalNumericValue memory value = stork.getTemporalNumericValueUnsafeV1(feedId);
        require(value.quantizedValue > 0, "Oracle: gia khong hop le");

        uint256 rawPrice = uint256(int256(value.quantizedValue));
        uint256 priceTimestamp = value.timestampNs / 1e9; // nano-giay -> giay

        require(block.timestamp - priceTimestamp <= maxStaleness, "Oracle: gia da cu (stale)");

        if (lastAcceptedPrice > 0) {
            uint256 diff = rawPrice > lastAcceptedPrice
                ? rawPrice - lastAcceptedPrice
                : lastAcceptedPrice - rawPrice;
            uint256 deviationBps = (diff * BPS_DENOMINATOR) / lastAcceptedPrice;
            require(deviationBps <= maxDeviationBps, "Oracle: gia lech qua nguong cho phep");
        }

        lastAcceptedPrice = rawPrice;
        lastAcceptedAt = block.timestamp;
        emit PriceAccepted(rawPrice, block.timestamp);

        return rawPrice;
    }

    /// @notice Ham chi doc, dung cho UI hien thi, khong cap nhat lastAcceptedPrice
    function viewPrice() external view returns (uint256 price, uint256 timestamp) {
        IStork.TemporalNumericValue memory value = stork.getTemporalNumericValueUnsafeV1(feedId);
        return (uint256(int256(value.quantizedValue)), value.timestampNs / 1e9);
    }
}