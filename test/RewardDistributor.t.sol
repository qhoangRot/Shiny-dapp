// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/RewardDistributor.sol";
import "../src/StakingVault.sol";
import "./mocks/MockERC20.sol";

contract RewardDistributorTest is Test {
    StakingVault internal vault;
    RewardDistributor internal distributor;
    MockERC20 internal usdc;
    MockERC20 internal eurc;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    uint256 internal constant ONE_TOKEN = 1e6;
    uint256 internal constant STARTING_BALANCE = 100_000e6;

    event ProgramCreated(
        uint256 indexed programId,
        address indexed asset,
        uint64 startTime,
        uint64 endTime,
        uint32 flexibleAnnualBps,
        uint32 growthAnnualBps,
        uint32 diamondAnnualBps
    );
    event ProgramFunded(uint256 indexed programId, address indexed funder, address indexed asset, uint256 amount);
    event ProgramRewardClaimed(
        uint256 indexed programId,
        uint256 indexed positionId,
        address indexed account,
        address asset,
        uint256 amount
    );
    event RewardClaimed(
        uint256 indexed positionId,
        address indexed account,
        address indexed asset,
        uint256 amount,
        uint256 programCount
    );

    function setUp() public {
        vm.warp(1_000_000);

        vault = new StakingVault(address(this));
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        vault.setSupportedAsset(address(usdc), true);
        vault.setSupportedAsset(address(eurc), true);

        distributor = new RewardDistributor(address(this), address(vault));

        usdc.mint(alice, STARTING_BALANCE);
        eurc.mint(alice, STARTING_BALANCE);
        usdc.mint(address(this), STARTING_BALANCE);
        eurc.mint(address(this), STARTING_BALANCE);

        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        eurc.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        usdc.approve(address(distributor), type(uint256).max);
        eurc.approve(address(distributor), type(uint256).max);
    }

    function test_ConstructorStoresOwnerAndVault() public view {
        assertEq(distributor.owner(), address(this));
        assertEq(address(distributor.stakingVault()), address(vault));
        assertEq(distributor.nextProgramId(), 1);
    }

    function test_CreateProgramStoresImmutableRatesAndDiscoveryData() public {
        uint64 startTime = uint64(block.timestamp + 1 days);
        uint64 endTime = uint64(startTime + 30 days);

        vm.expectEmit(true, true, false, true);
        emit ProgramCreated(1, address(usdc), startTime, endTime, 500, 600, 700);
        uint256 programId = distributor.createProgram(address(usdc), startTime, endTime, 500, 600, 700);

        (
            address asset,
            uint64 storedStart,
            uint64 storedEnd,
            uint32 flexibleBps,
            uint32 growthBps,
            uint32 diamondBps,
            uint256 funded,
            uint256 claimed
        ) = distributor.programs(programId);

        assertEq(asset, address(usdc));
        assertEq(storedStart, startTime);
        assertEq(storedEnd, endTime);
        assertEq(flexibleBps, 500);
        assertEq(growthBps, 600);
        assertEq(diamondBps, 700);
        assertEq(funded, 0);
        assertEq(claimed, 0);
        assertEq(distributor.latestProgramId(address(usdc)), programId);
        assertEq(distributor.assetProgramCount(address(usdc)), 1);
        assertEq(distributor.assetProgramIdAt(address(usdc), 0), programId);

        uint256[] memory ids = distributor.assetProgramIds(address(usdc));
        assertEq(ids.length, 1);
        assertEq(ids[0], programId);
    }

    function test_CreateProgramRejectsInvalidConfiguration() public {
        MockERC20 unsupported = new MockERC20("Unsupported", "NOPE", 6);
        uint64 nowTime = uint64(block.timestamp);

        vm.expectRevert(abi.encodeWithSelector(RewardDistributor.UnsupportedAsset.selector, address(unsupported)));
        distributor.createProgram(address(unsupported), nowTime, nowTime + 1 days, 500, 600, 700);

        vm.expectRevert(
            abi.encodeWithSelector(
                RewardDistributor.InvalidProgramWindow.selector,
                nowTime + 1 days,
                nowTime + 1 days
            )
        );
        distributor.createProgram(address(usdc), nowTime + 1 days, nowTime + 1 days, 500, 600, 700);

        vm.expectRevert(
            abi.encodeWithSelector(
                RewardDistributor.ProgramStartsInPast.selector,
                nowTime - 1,
                uint256(nowTime)
            )
        );
        distributor.createProgram(address(usdc), nowTime - 1, nowTime + 1 days, 500, 600, 700);

        vm.expectRevert(abi.encodeWithSelector(RewardDistributor.AnnualBpsTooHigh.selector, 10_001));
        distributor.createProgram(address(usdc), nowTime, nowTime + 1 days, 10_001, 600, 700);

        vm.expectRevert(RewardDistributor.AllRatesAreZero.selector);
        distributor.createProgram(address(usdc), nowTime, nowTime + 1 days, 0, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                RewardDistributor.InvalidTierRateOrder.selector,
                700,
                600,
                800
            )
        );
        distributor.createProgram(address(usdc), nowTime, nowTime + 1 days, 700, 600, 800);
    }

    function test_ProgramsForSameAssetCannotOverlapButMayBeAdjacent() public {
        uint64 firstStart = uint64(block.timestamp);
        uint64 firstEnd = uint64(block.timestamp + 30 days);
        distributor.createProgram(address(usdc), firstStart, firstEnd, 500, 600, 700);

        vm.expectRevert(
            abi.encodeWithSelector(
                RewardDistributor.ProgramOverlap.selector,
                address(usdc),
                uint256(firstEnd),
                uint256(firstEnd - 1)
            )
        );
        distributor.createProgram(address(usdc), firstEnd - 1, firstEnd + 30 days, 500, 600, 700);

        uint256 secondId =
            distributor.createProgram(address(usdc), firstEnd, firstEnd + 30 days, 400, 500, 600);
        assertEq(secondId, 2);
        assertEq(distributor.latestProgramId(address(usdc)), secondId);

        // A different asset has an independent timeline.
        uint256 eurcId =
            distributor.createProgram(address(eurc), firstStart, firstEnd, 300, 400, 500);
        assertEq(eurcId, 3);
        assertEq(distributor.latestProgramId(address(eurc)), eurcId);
    }

    function test_ProgramDoesNotAccrueBeforeItsStartOrRetroactively() public {
        uint256 positionId = _stakeUsdc(alice, 1_000e6, StakingVault.Tier.Flexible);

        // The position exists for 30 days while no reward program exists.
        vm.warp(block.timestamp + 30 days);
        uint64 programStart = uint64(block.timestamp + 1 days);
        uint64 programEnd = uint64(programStart + 365 days);
        uint256 programId =
            distributor.createProgram(address(usdc), programStart, programEnd, 1_000, 1_000, 1_000);
        _fund(programId, 200e6);

        vm.warp(programStart - 1);
        assertEq(distributor.pendingRewardForProgram(programId, positionId), 0);
        assertEq(distributor.pendingReward(positionId), 0);
        assertEq(distributor.currentAnnualRateBps(address(usdc), 0), 0);

        vm.warp(programStart);
        assertEq(distributor.pendingRewardForProgram(programId, positionId), 0);
        assertEq(distributor.currentAnnualRateBps(address(usdc), 0), 1_000);

        vm.warp(programStart + 1 days);
        uint256 expectedOneDay = (uint256(1_000e6) * 1_000 * 1 days) / (10_000 * 365 days);
        assertEq(distributor.pendingRewardForProgram(programId, positionId), expectedOneDay);
        assertEq(distributor.pendingReward(positionId), expectedOneDay);
    }

    function test_PositionCreatedDuringProgramAccruesOnlyFromStakeTime() public {
        uint64 programStart = uint64(block.timestamp + 1 days);
        uint64 programEnd = uint64(programStart + 365 days);
        uint256 programId =
            distributor.createProgram(address(usdc), programStart, programEnd, 1_000, 1_000, 1_000);
        _fund(programId, 200e6);

        vm.warp(programStart + 100 days);
        uint256 positionId = _stakeUsdc(alice, 1_000e6, StakingVault.Tier.Flexible);
        assertEq(distributor.pendingRewardForProgram(programId, positionId), 0);

        vm.warp(programStart + 101 days);
        uint256 expectedOneDay = (uint256(1_000e6) * 1_000 * 1 days) / (10_000 * 365 days);
        assertEq(distributor.pendingRewardForProgram(programId, positionId), expectedOneDay);
    }

    function test_AnnualBpsArePercentagePointsPerTier() public {
        uint256 flexibleId = _stakeUsdc(alice, 1_000e6, StakingVault.Tier.Flexible);
        uint256 growthId = _stakeUsdc(alice, 1_000e6, StakingVault.Tier.Growth);
        uint256 diamondId = _stakeUsdc(alice, 1_000e6, StakingVault.Tier.Diamond);

        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = uint64(block.timestamp + 365 days);
        uint256 programId =
            distributor.createProgram(address(usdc), startTime, endTime, 500, 600, 700);
        _fund(programId, 180e6);

        vm.warp(endTime);
        assertEq(distributor.pendingRewardForProgram(programId, flexibleId), 50e6);
        assertEq(distributor.pendingRewardForProgram(programId, growthId), 60e6);
        assertEq(distributor.pendingRewardForProgram(programId, diamondId), 70e6);
        assertEq(distributor.pendingReward(flexibleId), 50e6);
        assertEq(distributor.annualBpsForTier(programId, 0), 500);
        assertEq(distributor.annualBpsForTier(programId, 1), 600);
        assertEq(distributor.annualBpsForTier(programId, 2), 700);
    }

    function test_ClaimTransfersSameAssetAndSupportsIncrementalClaims() public {
        uint256 positionId = _stakeUsdc(alice, 1_000e6, StakingVault.Tier.Flexible);
        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = uint64(block.timestamp + 365 days);
        uint256 programId =
            distributor.createProgram(address(usdc), startTime, endTime, 1_000, 1_000, 1_000);

        vm.expectEmit(true, true, true, true);
        emit ProgramFunded(programId, address(this), address(usdc), 100e6);
        _fund(programId, 100e6);

        vm.warp(block.timestamp + 365 days / 2);
        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 eurcBefore = eurc.balanceOf(alice);

        vm.expectEmit(true, true, true, true);
        emit RewardClaimed(positionId, alice, address(usdc), 50e6, 1);
        vm.prank(alice);
        distributor.claimReward(positionId);
        assertEq(usdc.balanceOf(alice) - usdcBefore, 50e6);
        assertEq(eurc.balanceOf(alice), eurcBefore);

        vm.warp(endTime);
        uint256 secondBalanceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        distributor.claimReward(positionId);
        assertEq(usdc.balanceOf(alice) - secondBalanceBefore, 50e6);
        assertEq(distributor.claimedByPosition(programId, positionId), 100e6);
        assertEq(distributor.programAvailableReserve(programId), 0);
        assertEq(distributor.reservedByAsset(address(usdc)), 0);

        vm.expectRevert(
            abi.encodeWithSelector(RewardDistributor.NoRewardsToClaim.selector, positionId)
        );
        vm.prank(alice);
        distributor.claimReward(positionId);
    }

    function test_OnlyOwnerOfActivePositionMayClaim() public {
        uint256 positionId = _stakeUsdc(alice, 1_000e6, StakingVault.Tier.Flexible);
        uint64 startTime = uint64(block.timestamp);
        uint256 programId =
            distributor.createProgram(address(usdc), startTime, startTime + 365 days, 1_000, 1_000, 1_000);
        _fund(programId, 100e6);
        vm.warp(block.timestamp + 1 days);

        vm.expectRevert(
            abi.encodeWithSelector(RewardDistributor.NotPositionOwner.selector, positionId, bob)
        );
        vm.prank(bob);
        distributor.claimReward(positionId);

        vm.prank(alice);
        vault.withdraw(positionId);
        assertEq(distributor.pendingReward(positionId), 0);

        vm.expectRevert(
            abi.encodeWithSelector(RewardDistributor.PositionInactive.selector, positionId)
        );
        vm.prank(alice);
        distributor.claimReward(positionId);
    }

    function test_ExplicitProgramClaimHelperRemainsAvailable() public {
        uint256 positionId = _stakeUsdc(alice, 1_000e6, StakingVault.Tier.Flexible);
        uint64 startTime = uint64(block.timestamp);
        uint256 programId =
            distributor.createProgram(address(usdc), startTime, startTime + 365 days, 1_000, 1_000, 1_000);
        _fund(programId, 100e6);
        vm.warp(block.timestamp + 365 days);

        vm.expectEmit(true, true, true, true);
        emit ProgramRewardClaimed(programId, positionId, alice, address(usdc), 100e6);
        vm.prank(alice);
        distributor.claimProgramReward(programId, positionId);

        assertEq(distributor.pendingRewardForProgram(programId, positionId), 0);
        assertEq(distributor.pendingReward(positionId), 0);
    }

    function test_UnderfundedProgramRevertsWithoutTouchingVaultPrincipal() public {
        uint256 positionId = _stakeUsdc(alice, 1_000e6, StakingVault.Tier.Flexible);
        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = uint64(block.timestamp + 365 days);
        uint256 programId =
            distributor.createProgram(address(usdc), startTime, endTime, 1_000, 1_000, 1_000);
        _fund(programId, 10e6);
        vm.warp(endTime);

        vm.expectRevert(
            abi.encodeWithSelector(
                RewardDistributor.InsufficientProgramReserve.selector,
                programId,
                10e6,
                100e6
            )
        );
        vm.prank(alice);
        distributor.claimReward(positionId);

        assertEq(distributor.claimedByPosition(programId, positionId), 0);
        assertEq(usdc.balanceOf(address(distributor)), 10e6);
        assertEq(usdc.balanceOf(address(vault)), 1_000e6);

        _fund(programId, 90e6);
        vm.prank(alice);
        distributor.claimReward(positionId);

        assertEq(usdc.balanceOf(address(distributor)), 0);
        assertEq(usdc.balanceOf(address(vault)), 1_000e6);

        // Principal remains fully withdrawable after every reward token was paid.
        vm.prank(alice);
        vault.withdraw(positionId);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_UsdcAndEurcProgramsPayIndependentSameAssetReserves() public {
        uint256 usdcPosition = _stakeUsdc(alice, 1_000e6, StakingVault.Tier.Flexible);
        uint256 eurcPosition = _stakeEurc(alice, 1_000e6, StakingVault.Tier.Flexible);
        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = uint64(block.timestamp + 365 days);

        uint256 usdcProgram =
            distributor.createProgram(address(usdc), startTime, endTime, 500, 500, 500);
        uint256 eurcProgram =
            distributor.createProgram(address(eurc), startTime, endTime, 700, 700, 700);
        _fund(usdcProgram, 50e6);
        _fund(eurcProgram, 70e6);
        vm.warp(endTime);

        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 eurcBefore = eurc.balanceOf(alice);
        vm.startPrank(alice);
        distributor.claimReward(usdcPosition);
        distributor.claimReward(eurcPosition);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice) - usdcBefore, 50e6);
        assertEq(eurc.balanceOf(alice) - eurcBefore, 70e6);
        assertEq(distributor.reservedByAsset(address(usdc)), 0);
        assertEq(distributor.reservedByAsset(address(eurc)), 0);
    }

    function test_AdjacentProgramsAccrueWithoutOverlapOrGap() public {
        uint256 positionId = _stakeUsdc(alice, 1_000e6, StakingVault.Tier.Flexible);
        uint64 firstStart = uint64(block.timestamp);
        uint64 boundary = uint64(block.timestamp + 365 days);
        uint64 secondEnd = uint64(boundary + 365 days);

        uint256 firstProgram =
            distributor.createProgram(address(usdc), firstStart, boundary, 500, 600, 700);
        uint256 secondProgram =
            distributor.createProgram(address(usdc), boundary, secondEnd, 700, 800, 900);
        _fund(firstProgram, 50e6);
        _fund(secondProgram, 70e6);

        vm.warp(firstStart + 100 days);
        assertEq(distributor.currentAnnualRateBps(address(usdc), 0), 500);
        assertEq(distributor.currentAnnualRateBps(address(usdc), 1), 600);
        assertEq(distributor.currentAnnualRateBps(address(usdc), 2), 700);

        vm.warp(boundary);
        assertEq(distributor.currentAnnualRateBps(address(usdc), 0), 700);
        assertEq(distributor.currentAnnualRateBps(address(usdc), 1), 800);
        assertEq(distributor.currentAnnualRateBps(address(usdc), 2), 900);

        vm.warp(secondEnd);
        assertEq(distributor.currentAnnualRateBps(address(usdc), 0), 0);
        assertEq(distributor.pendingRewardForProgram(firstProgram, positionId), 50e6);
        assertEq(distributor.pendingRewardForProgram(secondProgram, positionId), 70e6);
        assertEq(distributor.pendingReward(positionId), 120e6);

        uint256 balanceBefore = usdc.balanceOf(alice);
        vm.expectEmit(true, true, true, true);
        emit RewardClaimed(positionId, alice, address(usdc), 120e6, 2);
        vm.prank(alice);
        distributor.claimReward(positionId);
        assertEq(usdc.balanceOf(alice) - balanceBefore, 120e6);
        assertEq(distributor.claimedByPosition(firstProgram, positionId), 50e6);
        assertEq(distributor.claimedByPosition(secondProgram, positionId), 70e6);
        assertEq(distributor.programAvailableReserve(firstProgram), 0);
        assertEq(distributor.programAvailableReserve(secondProgram), 0);
    }

    function testFuzz_RewardFormulaMatchesAnnualBps(uint96 rawPrincipal, uint16 rawBps, uint32 rawElapsed)
        public
    {
        uint256 principal = bound(uint256(rawPrincipal), 10e6, 90_000e6);
        uint32 annualBps = uint32(bound(uint256(rawBps), 1, 10_000));
        uint256 elapsed = bound(uint256(rawElapsed), 1, 365 days);

        uint256 positionId = _stakeUsdc(alice, principal, StakingVault.Tier.Flexible);
        uint64 startTime = uint64(block.timestamp);
        uint256 programId = distributor.createProgram(
            address(usdc),
            startTime,
            uint64(block.timestamp + 365 days),
            annualBps,
            annualBps,
            annualBps
        );

        vm.warp(block.timestamp + elapsed);
        uint256 expected = (principal * uint256(annualBps) * elapsed) / (10_000 * 365 days);
        assertEq(distributor.pendingRewardForProgram(programId, positionId), expected);
    }

    function _stakeUsdc(address account, uint256 amount, StakingVault.Tier tier)
        internal
        returns (uint256)
    {
        vm.prank(account);
        return vault.stake(address(usdc), amount, tier);
    }

    function _stakeEurc(address account, uint256 amount, StakingVault.Tier tier)
        internal
        returns (uint256)
    {
        vm.prank(account);
        return vault.stake(address(eurc), amount, tier);
    }

    function _fund(uint256 programId, uint256 amount) internal {
        distributor.fundProgram(programId, amount);
    }
}
