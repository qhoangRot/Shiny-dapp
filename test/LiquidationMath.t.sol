// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LiquidationMath} from "../src/libraries/LiquidationMath.sol";

contract LiquidationMathHarness {
    function quote(LiquidationMath.QuoteParams memory params) external pure returns (LiquidationMath.Quote memory) {
        return LiquidationMath.quote(params);
    }

    function assetValueWad(uint256 amount, uint256 priceWad, uint256 assetUnit) external pure returns (uint256) {
        return LiquidationMath.assetValueWad(amount, priceWad, assetUnit);
    }

    function effectiveCloseFactorBps(uint256 hf, uint256 threshold, uint256 standardFactor)
        external
        pure
        returns (uint256)
    {
        return LiquidationMath.effectiveCloseFactorBps(hf, threshold, standardFactor);
    }

    function healthFactor(uint256 adjustedCollateralValueWad, uint256 debtValueWad) external pure returns (uint256) {
        return LiquidationMath.healthFactor(adjustedCollateralValueWad, debtValueWad);
    }

    function maxPortfolioDebtCoverableWad(uint256[] memory values, uint256[] memory bonuses)
        external
        pure
        returns (uint256)
    {
        return LiquidationMath.maxPortfolioDebtCoverableWad(values, bonuses);
    }

    function isEconomicDeficit(uint256[] memory values, uint256[] memory bonuses, uint256 debtValue)
        external
        pure
        returns (bool)
    {
        return LiquidationMath.isEconomicDeficit(values, bonuses, debtValue);
    }

    function validateRiskParameters(uint256 bonus, uint256 closeFactor, uint256 threshold) external pure {
        LiquidationMath.validateRiskParameters(bonus, closeFactor, threshold);
    }
}

contract LiquidationMathTest is Test {
    uint256 internal constant USDC_UNIT = 1e6;
    uint256 internal constant EURC_UNIT = 1e6;
    uint256 internal constant WAD = 1e18;

    LiquidationMathHarness internal math;

    function setUp() public {
        math = new LiquidationMathHarness();
    }

    function test_QuoteCapsByStandardCloseFactor() public view {
        LiquidationMath.Quote memory result = math.quote(
            _params({
                requested: 500e6,
                outstanding: 500e6,
                selectedCollateral: 1_000e6,
                debtPrice: 1.08e18,
                collateralPrice: WAD,
                bonusBps: 500,
                closeFactorBps: 5_000
            })
        );

        assertEq(result.closeFactorDebtLimit, 250e6);
        assertEq(result.actualDebtToCover, 250e6);
        assertEq(result.debtValueWad, 270e18);
        assertEq(result.baseCollateral, 270e6);
        assertEq(result.bonusCollateral, 13.5e6);
        assertEq(result.collateralToSeize, 283.5e6);
    }

    function test_QuoteCapsBySelectedCollateral() public view {
        LiquidationMath.Quote memory result = math.quote(
            _params({
                requested: 1_000e6,
                outstanding: 1_000e6,
                selectedCollateral: 105e6,
                debtPrice: WAD,
                collateralPrice: WAD,
                bonusBps: 500,
                closeFactorBps: 10_000
            })
        );

        assertEq(result.maxDebtFromSelectedCollateral, 100e6);
        assertEq(result.actualDebtToCover, 100e6);
        assertEq(result.collateralToSeize, 105e6);
    }

    function test_AssetValueNormalizesTokenDecimals() public view {
        assertEq(math.assetValueWad(25e6, 1.08e18, EURC_UNIT), 27e18);
        assertEq(math.assetValueWad(2 ether, 1.25e18, 1 ether), 2.5e18);
    }

    function test_EffectiveCloseFactorSelectsDeepBranch() public view {
        assertEq(math.effectiveCloseFactorBps(0.96e18, 0.95e18, 5_000), 5_000);
        assertEq(math.effectiveCloseFactorBps(0.95e18, 0.95e18, 5_000), 5_000);
        assertEq(math.effectiveCloseFactorBps(0.949e18, 0.95e18, 5_000), 10_000);
    }

    function test_HealthFactorReturnsMaxWithoutDebt() public view {
        assertEq(math.healthFactor(100e18, 0), type(uint256).max);
        assertEq(math.healthFactor(80e18, 100e18), 0.8e18);
    }

    function test_DeficitIncludesLiquidationBonus() public view {
        uint256[] memory values = new uint256[](1);
        uint256[] memory bonuses = new uint256[](1);
        values[0] = 100e18;
        bonuses[0] = 500;

        uint256 coverable = math.maxPortfolioDebtCoverableWad(values, bonuses);
        assertEq(coverable, 95_238095238095238095);
        assertFalse(math.isEconomicDeficit(values, bonuses, 95e18));
        assertTrue(math.isEconomicDeficit(values, bonuses, 96e18));
    }

    function test_MultiAssetDeficitUsesCompletePortfolio() public view {
        uint256[] memory values = new uint256[](2);
        uint256[] memory bonuses = new uint256[](2);
        values[0] = 60e18;
        values[1] = 50e18;
        bonuses[0] = 500;
        bonuses[1] = 1_000;

        assertFalse(math.isEconomicDeficit(values, bonuses, 100e18));
        assertTrue(math.isEconomicDeficit(values, bonuses, 103e18));
    }

    function test_RevertWhenRiskParametersOutsideHardBounds() public {
        vm.expectRevert(LiquidationMath.InvalidLiquidationBonus.selector);
        math.validateRiskParameters(199, 5_000, 0.95e18);

        vm.expectRevert(LiquidationMath.InvalidLiquidationBonus.selector);
        math.validateRiskParameters(1_501, 5_000, 0.95e18);

        vm.expectRevert(LiquidationMath.InvalidCloseFactor.selector);
        math.validateRiskParameters(500, 2_499, 0.95e18);

        vm.expectRevert(LiquidationMath.InvalidCloseFactor.selector);
        math.validateRiskParameters(500, 7_501, 0.95e18);

        vm.expectRevert(LiquidationMath.InvalidFullLiquidationThreshold.selector);
        math.validateRiskParameters(500, 5_000, 0.899e18);

        vm.expectRevert(LiquidationMath.InvalidFullLiquidationThreshold.selector);
        math.validateRiskParameters(500, 5_000, 0.991e18);
    }

    function test_RevertWhenEffectiveCloseFactorIsNeitherConfiguredNorDeep() public {
        LiquidationMath.QuoteParams memory params = _params({
            requested: 100e6,
            outstanding: 100e6,
            selectedCollateral: 200e6,
            debtPrice: WAD,
            collateralPrice: WAD,
            bonusBps: 500,
            closeFactorBps: 8_000
        });

        vm.expectRevert(LiquidationMath.InvalidCloseFactor.selector);
        math.quote(params);
    }

    function test_RevertWhenCollateralOutputRoundsToZero() public {
        LiquidationMath.QuoteParams memory params = LiquidationMath.QuoteParams({
            requestedDebtToCover: 1,
            outstandingDebt: 2,
            selectedCollateral: 1e6,
            debtPriceWad: WAD,
            collateralPriceWad: WAD,
            debtUnit: 1e18,
            collateralUnit: 1e6,
            liquidationBonusBps: 500,
            effectiveCloseFactorBps: 10_000
        });

        vm.expectRevert(LiquidationMath.DustCollateralOut.selector);
        math.quote(params);
    }

    function testFuzz_QuoteNeverExceedsAnyCap(
        uint96 requestedSeed,
        uint96 outstandingSeed,
        uint96 collateralSeed,
        uint16 bonusSeed,
        bool deep
    ) public view {
        uint256 requested = bound(uint256(requestedSeed), 1e6, 1e24);
        uint256 outstanding = bound(uint256(outstandingSeed), 1e6, 1e24);
        uint256 selected = bound(uint256(collateralSeed), 1e6, 1e24);
        uint256 bonus = bound(uint256(bonusSeed), 200, 1_500);
        uint256 closeFactor = deep ? 10_000 : 5_000;

        LiquidationMath.Quote memory result = math.quote(
            _params({
                requested: requested,
                outstanding: outstanding,
                selectedCollateral: selected,
                debtPrice: WAD,
                collateralPrice: WAD,
                bonusBps: bonus,
                closeFactorBps: closeFactor
            })
        );

        assertLe(result.actualDebtToCover, requested);
        assertLe(result.actualDebtToCover, outstanding);
        assertLe(result.actualDebtToCover, result.closeFactorDebtLimit);
        assertLe(result.actualDebtToCover, result.maxDebtFromSelectedCollateral);
        assertLe(result.collateralToSeize, selected);
        assertEq(result.baseCollateral + result.bonusCollateral, result.collateralToSeize);
    }

    function testFuzz_MaxPortfolioCoverableNeverExceedsRawCollateral(
        uint128 first,
        uint128 second,
        uint16 firstBonusSeed,
        uint16 secondBonusSeed
    ) public view {
        uint256[] memory values = new uint256[](2);
        uint256[] memory bonuses = new uint256[](2);
        values[0] = uint256(first);
        values[1] = uint256(second);
        bonuses[0] = bound(uint256(firstBonusSeed), 200, 1_500);
        bonuses[1] = bound(uint256(secondBonusSeed), 200, 1_500);

        assertLe(math.maxPortfolioDebtCoverableWad(values, bonuses), values[0] + values[1]);
    }

    function _params(
        uint256 requested,
        uint256 outstanding,
        uint256 selectedCollateral,
        uint256 debtPrice,
        uint256 collateralPrice,
        uint256 bonusBps,
        uint256 closeFactorBps
    ) internal pure returns (LiquidationMath.QuoteParams memory) {
        return LiquidationMath.QuoteParams({
            requestedDebtToCover: requested,
            outstandingDebt: outstanding,
            selectedCollateral: selectedCollateral,
            debtPriceWad: debtPrice,
            collateralPriceWad: collateralPrice,
            debtUnit: EURC_UNIT,
            collateralUnit: USDC_UNIT,
            liquidationBonusBps: bonusBps,
            effectiveCloseFactorBps: closeFactorBps
        });
    }
}
