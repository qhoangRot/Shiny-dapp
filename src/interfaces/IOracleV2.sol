// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Validated per-asset USD price adapter. Prices use 18 decimals.
/// @dev Implementations MUST reject stale, paused, or circuit-breaker-invalid
///      prices from getValidatedPrice() and MUST report those states as false
///      from isHealthy(). This interface defines the boundary; validation logic
///      belongs to the concrete production oracle adapter.
interface IOracleV2 {
    /// @return priceWad Validated USD-like price with 18 decimals.
    /// @return updatedAt Timestamp of the underlying oracle observation.
    function getValidatedPrice(address asset) external returns (uint256 priceWad, uint256 updatedAt);

    function isHealthy(address asset) external view returns (bool);
}
