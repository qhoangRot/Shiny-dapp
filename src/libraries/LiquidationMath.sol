// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title LiquidationMath
/// @notice Full-precision, asset-decimal-aware liquidation calculations for Shiny V2.
/// @dev Liquidation outputs round down. Any rounding dust stays with the borrower rather
///      than being silently awarded to the liquidator.
library LiquidationMath {
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant HF_PRECISION = 1e18;

    uint256 internal constant MIN_LIQUIDATION_BONUS_BPS = 200;
    uint256 internal constant MAX_LIQUIDATION_BONUS_BPS = 1_500;
    uint256 internal constant MIN_CLOSE_FACTOR_BPS = 2_500;
    uint256 internal constant MAX_CLOSE_FACTOR_BPS = 7_500;
    uint256 internal constant DEEP_LIQUIDATION_FACTOR_BPS = 10_000;
    uint256 internal constant MIN_FULL_LIQUIDATION_HF = 0.9e18;
    uint256 internal constant MAX_FULL_LIQUIDATION_HF = 0.99e18;

    struct QuoteParams {
        uint256 requestedDebtToCover;
        uint256 outstandingDebt;
        uint256 selectedCollateral;
        uint256 debtPriceWad;
        uint256 collateralPriceWad;
        uint256 debtUnit;
        uint256 collateralUnit;
        uint256 liquidationBonusBps;
        uint256 effectiveCloseFactorBps;
    }

    struct Quote {
        uint256 actualDebtToCover;
        uint256 debtValueWad;
        uint256 baseCollateral;
        uint256 bonusCollateral;
        uint256 collateralToSeize;
        uint256 maxDebtFromSelectedCollateral;
        uint256 closeFactorDebtLimit;
    }

    error ZeroAmount();
    error DustCollateralOut();
    error InvalidPrice();
    error InvalidAssetUnit();
    error InvalidLiquidationBonus();
    error InvalidCloseFactor();
    error InvalidFullLiquidationThreshold();
    error ArrayLengthMismatch();

    /// @notice Returns a liquidation quote capped by request, debt, close factor,
    ///         and the collateral represented by the selected position IDs.
    function quote(QuoteParams memory params) internal pure returns (Quote memory result) {
        _validateQuoteParams(params);

        uint256 selectedCollateralValueWad =
            assetValueWad(params.selectedCollateral, params.collateralPriceWad, params.collateralUnit);
        uint256 maxDebtValueWad =
            Math.mulDiv(selectedCollateralValueWad, BPS_DENOMINATOR, BPS_DENOMINATOR + params.liquidationBonusBps);

        result.maxDebtFromSelectedCollateral = Math.mulDiv(maxDebtValueWad, params.debtUnit, params.debtPriceWad);
        result.closeFactorDebtLimit =
            Math.mulDiv(params.outstandingDebt, params.effectiveCloseFactorBps, BPS_DENOMINATOR);

        result.actualDebtToCover = _min(
            _min(params.requestedDebtToCover, params.outstandingDebt),
            _min(result.closeFactorDebtLimit, result.maxDebtFromSelectedCollateral)
        );
        if (result.actualDebtToCover == 0) revert ZeroAmount();

        result.debtValueWad = assetValueWad(result.actualDebtToCover, params.debtPriceWad, params.debtUnit);
        result.baseCollateral = Math.mulDiv(result.debtValueWad, params.collateralUnit, params.collateralPriceWad);
        result.collateralToSeize =
            Math.mulDiv(result.baseCollateral, BPS_DENOMINATOR + params.liquidationBonusBps, BPS_DENOMINATOR);
        if (result.collateralToSeize == 0) revert DustCollateralOut();
        result.bonusCollateral = result.collateralToSeize - result.baseCollateral;

        // This should follow from the conservative cap above. Keep the assertion
        // as a fail-closed invariant if future rounding changes violate it.
        assert(result.collateralToSeize <= params.selectedCollateral);
    }

    /// @notice Quote value in 18-decimal USD-like units.
    function assetValueWad(uint256 amount, uint256 priceWad, uint256 assetUnit) internal pure returns (uint256) {
        if (priceWad == 0) revert InvalidPrice();
        if (assetUnit == 0) revert InvalidAssetUnit();
        return Math.mulDiv(amount, priceWad, assetUnit);
    }

    /// @notice Selects the standard or deep close factor from execution-time HF.
    function effectiveCloseFactorBps(
        uint256 currentHealthFactor,
        uint256 fullLiquidationHfThreshold,
        uint256 standardCloseFactorBps
    ) internal pure returns (uint256) {
        _validateStandardCloseFactor(standardCloseFactorBps);
        _validateFullLiquidationThreshold(fullLiquidationHfThreshold);
        return currentHealthFactor < fullLiquidationHfThreshold ? DEEP_LIQUIDATION_FACTOR_BPS : standardCloseFactorBps;
    }

    /// @notice Health Factor from risk-adjusted collateral and debt values.
    function healthFactor(uint256 adjustedCollateralValueWad, uint256 debtValueWad) internal pure returns (uint256) {
        if (debtValueWad == 0) return type(uint256).max;
        return Math.mulDiv(adjustedCollateralValueWad, HF_PRECISION, debtValueWad);
    }

    /// @notice Maximum debt value coverable by a portfolio after liquidation bonuses.
    function maxPortfolioDebtCoverableWad(uint256[] memory collateralValuesWad, uint256[] memory liquidationBonusBps)
        internal
        pure
        returns (uint256 totalCoverableWad)
    {
        if (collateralValuesWad.length != liquidationBonusBps.length) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i; i < collateralValuesWad.length; ++i) {
            _validateBonus(liquidationBonusBps[i]);
            totalCoverableWad += Math.mulDiv(
                collateralValuesWad[i], BPS_DENOMINATOR, BPS_DENOMINATOR + liquidationBonusBps[i]
            );
        }
    }

    function isEconomicDeficit(
        uint256[] memory collateralValuesWad,
        uint256[] memory liquidationBonusBps,
        uint256 remainingDebtValueWad
    ) internal pure returns (bool) {
        return maxPortfolioDebtCoverableWad(collateralValuesWad, liquidationBonusBps) < remainingDebtValueWad;
    }

    /// @notice Enforces immutable governance bounds from the V2 specification.
    function validateRiskParameters(
        uint256 liquidationBonusBps,
        uint256 standardCloseFactorBps,
        uint256 fullLiquidationHfThreshold
    ) internal pure {
        _validateBonus(liquidationBonusBps);
        _validateStandardCloseFactor(standardCloseFactorBps);
        _validateFullLiquidationThreshold(fullLiquidationHfThreshold);
    }

    function _validateQuoteParams(QuoteParams memory params) private pure {
        if (params.requestedDebtToCover == 0 || params.outstandingDebt == 0 || params.selectedCollateral == 0) {
            revert ZeroAmount();
        }
        if (params.debtPriceWad == 0 || params.collateralPriceWad == 0) {
            revert InvalidPrice();
        }
        if (params.debtUnit == 0 || params.collateralUnit == 0) revert InvalidAssetUnit();
        _validateBonus(params.liquidationBonusBps);
        if (
            params.effectiveCloseFactorBps < MIN_CLOSE_FACTOR_BPS
                || (params.effectiveCloseFactorBps > MAX_CLOSE_FACTOR_BPS
                    && params.effectiveCloseFactorBps != DEEP_LIQUIDATION_FACTOR_BPS)
        ) revert InvalidCloseFactor();
    }

    function _validateBonus(uint256 liquidationBonusBps) private pure {
        if (liquidationBonusBps < MIN_LIQUIDATION_BONUS_BPS || liquidationBonusBps > MAX_LIQUIDATION_BONUS_BPS) {
            revert InvalidLiquidationBonus();
        }
    }

    function _validateStandardCloseFactor(uint256 standardCloseFactorBps) private pure {
        if (standardCloseFactorBps < MIN_CLOSE_FACTOR_BPS || standardCloseFactorBps > MAX_CLOSE_FACTOR_BPS) {
            revert InvalidCloseFactor();
        }
    }

    function _validateFullLiquidationThreshold(uint256 fullLiquidationHfThreshold) private pure {
        if (
            fullLiquidationHfThreshold < MIN_FULL_LIQUIDATION_HF || fullLiquidationHfThreshold > MAX_FULL_LIQUIDATION_HF
        ) revert InvalidFullLiquidationThreshold();
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
