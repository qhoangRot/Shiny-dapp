// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Gia lap Stork Oracle contract, dung de test LendingPool ma khong can goi mang that
contract MockStork {
    struct TemporalNumericValue {
        uint64 timestampNs;
        int192 quantizedValue;
    }

    mapping(bytes32 => TemporalNumericValue) public values;

    /// @notice Ham test-only: dat gia thu cong. price phai scale 1e18 (vi du 1.08 USD = 1.08e18)
    function setPrice(bytes32 id, int192 price) external {
        values[id] = TemporalNumericValue({timestampNs: uint64(block.timestamp) * 1e9, quantizedValue: price});
    }

    function getTemporalNumericValueUnsafeV1(bytes32 id) external view returns (TemporalNumericValue memory) {
        return values[id];
    }
}
