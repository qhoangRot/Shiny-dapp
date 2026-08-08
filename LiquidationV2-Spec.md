# Shiny Liquidation V2 Specification

Status: design-frozen draft for implementation and security review  
Target: `StakingVaultV2` + `LendingPoolV2` on Arc Testnet  
Solidity target: `0.8.24`

## 1. Purpose

This specification defines an enforceable liquidation path for Shiny positions whose collateral remains in `StakingVaultV2` while supporting debt in `LendingPoolV2`.

The current V1 architecture counts staked principal as collateral but cannot seize that principal during liquidation. V2 MUST fix this solvency gap before protocol revenue routing or a mainnet deployment is considered complete.

The V1 deployment and its active positions MUST NOT be modified in place. V2 is a parallel deployment with an explicit migration period.

## 2. Normative language

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` describe implementation requirements. Illustrative Solidity below is not the final ABI unless stated otherwise.

## 3. Core safety invariants

For every successful liquidation:

1. The account Health Factor before liquidation MUST be below `1e18`.
2. Debt reduction MUST equal the debt tokens actually received from the liquidator.
3. Staked principal reduction MUST equal collateral actually transferred to the liquidator.
4. `interestPaid` MUST be separated from `principalPaid` and added to revenue accounting for the debt asset.
5. Revenue reserved in `pendingRevenue` MUST NOT be borrowable liquidity.
6. A position MUST NOT be seized twice, seized beyond its principal, or seized for a different owner or asset.
7. Rewards earned before principal reduction MUST be checkpointed and preserved for the position owner.
8. All state changes and token movements MUST be atomic. No partial-success liquidation is permitted.
9. The liquidator MUST receive at least `minCollateralOut` or the transaction MUST revert.
10. For a recoverable partial liquidation, Health Factor after liquidation MUST be greater than Health Factor before liquidation.

### 3.1 Deep insolvency exception

Health Factor improvement is not mathematically guaranteed once the complete eligible collateral portfolio cannot cover debt plus liquidation incentives. Requiring unconditional HF improvement could block the liquidation of deeply underwater accounts.

For a single collateral asset, ignoring conservative rounding:

```text
maxDebtCoverable = collateralValue / (1 + liquidationBonus)
deficitEconomicCondition = maxDebtCoverable < remainingDebt
```

For multiple eligible collateral assets:

```text
maxPortfolioDebtCoverable =
    sum(collateralValue[i] / (1 + liquidationBonus[i]))

deficitEconomicCondition =
    maxPortfolioDebtCoverable < remainingDebt
```

Every value in this classification MUST come from one validated portfolio snapshot. This economic classification does not itself authorize a write-off. Bad debt may be crystallized only through the separate finalization rules in Section 14 after every eligible collateral position has been exhausted.

Therefore:

- Recoverable partial liquidations MUST improve HF.
- A deep-insolvency branch MAY exhaust the selected collateral or fully close the selected debt even when HF cannot improve.
- That branch MUST minimize remaining bad debt, MUST NOT create additional debt, and MUST emit the remaining uncovered debt explicitly.
- Tests MUST cover both the normal improvement branch and the deep-insolvency exception.

## 4. Supported liquidation shape

One `liquidate` call operates on:

- one user;
- one debt asset;
- one collateral asset;
- one or more positions containing that collateral asset.

V2 MUST NOT seize USDC and EURC in one liquidation call. If the first collateral asset is insufficient and the account remains liquidatable, a later transaction MAY target the other asset.

Asset selection belongs to the liquidator or keeper. The protocol MUST NOT silently choose an asset order. Each call is independently atomic and revalidates the latest debt, collateral, oracle prices, and Health Factor.

## 5. Proposed interfaces

### 5.1 LendingPoolV2

```solidity
function liquidate(
    address user,
    address debtAsset,
    address collateralAsset,
    uint256 requestedDebtToCover,
    uint256[] calldata positionIds,
    uint256 minCollateralOut,
    uint256 deadline
) external returns (
    uint256 actualDebtCovered,
    uint256 collateralSeized
);

function settleRevenue(address asset) external returns (uint256 amountSettled);

function finalizeBadDebt(
    address user,
    address debtAsset
) external returns (uint256 deficitCreated);

function resolveDeficitFromInsurance(
    address asset
) external returns (uint256 amountCovered);

function coverDeficit(
    address asset,
    uint256 amount
) external returns (uint256 amountCovered);
```

### 5.2 StakingVaultV2

```solidity
function getSeizablePrincipal(
    address user,
    address asset,
    uint256[] calldata positionIds
) external view returns (uint256);

function getTotalSeizablePrincipal(
    address user,
    address asset
) external view returns (uint256);

function seizeStakedCollateral(
    address user,
    address asset,
    uint256[] calldata positionIds,
    uint256 amount,
    address recipient
) external returns (uint256 amountSeized);
```

`seizeStakedCollateral` MUST be callable only by the authorized LendingPool and MUST use exact-or-revert behavior.

## 6. Position ID rules

1. `positionIds` MUST be non-empty.
2. IDs MUST be strictly increasing. This rejects duplicates without a `seen` mapping.
3. A single call MUST include no more than 32 IDs.
4. Every position MUST belong to `user`, contain `collateralAsset`, have non-zero principal, and not be withdrawn.
5. Locked Growth and Diamond positions remain seizable. A lock limits voluntary withdrawal, not protocol liquidation.
6. `getSeizablePrincipal` and the state-changing execution MUST apply the same validation rules.

LendingPool MUST size the liquidation from the principal represented by the supplied IDs, not from the user's total portfolio. StakingVault MUST independently revalidate that selected principal is at least the exact requested seizure amount. It MUST NOT silently seize less.

## 7. Oracle requirements

Oracle validation MUST happen before prices are accepted into the liquidation snapshot.

For every non-fixed price used by liquidation, the oracle adapter MUST verify:

- oracle is not paused;
- price is positive;
- observation is not stale;
- deviation from the last accepted price is within the configured circuit breaker;
- decimals and quote currency are known.

The validated debt and collateral prices MUST each be read once and reused for the complete calculation. A liquidation MUST NOT mix values from different oracle reads.

If any oracle validation fails, liquidation MUST revert before debt or collateral state is changed. The existing `PriceOracle.getPrice()` behavior is the minimum validation baseline; production deployment requires a production-grade feed rather than an owner-updated test price.

## 8. Liquidation mathematics

All calculations MUST use `Math.mulDiv` or an equivalent full-precision implementation. Token decimals and oracle decimals MUST be normalized explicitly.

```text
debtValue =
    actualDebtToCover * debtPrice

baseCollateral =
    debtValue / collateralPrice

bonusCollateral =
    baseCollateral * liquidationBonusBps / 10,000

collateralToSeize =
    baseCollateral + bonusCollateral
```

When selected collateral is insufficient:

```text
maxDebtValueFromCollateral =
    selectedCollateralValue * 10,000
    / (10,000 + liquidationBonusBps)

actualDebtToCover = min(
    requestedDebtToCover,
    outstandingDebt,
    closeFactorDebtLimit,
    maxDebtFromSelectedCollateral
)
```

The implementation MUST calculate `actualDebtToCover` before collecting debt tokens. It MUST then derive `collateralToSeize` from that final debt amount.

Debt coverage MUST round down. Collateral seizure MUST use a documented conservative rounding direction and MUST never exceed validated selected principal. Rounding dust remains in the position or reserve; it MUST NOT be silently awarded to the liquidator.

## 9. Close factor and risk parameters

Defaults and hard bounds:

```text
DEFAULT_LIQUIDATION_BONUS_BPS = 500     (5%)
MIN_LIQUIDATION_BONUS_BPS     = 200     (2%)
MAX_LIQUIDATION_BONUS_BPS     = 1500   (15%)

DEFAULT_CLOSE_FACTOR_BPS       = 5000   (50%)
MIN_CLOSE_FACTOR_BPS           = 2500   (25%)
MAX_CLOSE_FACTOR_BPS           = 7500   (75%)

DEFAULT_FULL_LIQUIDATION_HF    = 0.95e18
MIN_FULL_LIQUIDATION_HF        = 0.90e18
MAX_FULL_LIQUIDATION_HF        = 0.99e18

DEEP_LIQUIDATION_FACTOR_BPS    = 10000 (100%, fixed)
```

Rules:

- `HF >= 1e18`: liquidation is forbidden.
- `fullLiquidationHfThreshold <= HF < 1e18`: standard close factor applies.
- `HF < fullLiquidationHfThreshold`: up to 100% may be covered, subject to actual debt and selected collateral.

Risk setters MUST enforce the hard bounds in Solidity. Mainnet setters MUST be controlled by `TimelockController` plus multisig, with a minimum proposed delay of 48 hours. A compromised governance executor MUST still be unable to bypass hard bounds.

Testnet MAY initially use a deployment multisig while preserving the same hard bounds.

## 10. Reward checkpoint for partial seizure

V2 MUST have one canonical reward source. The legacy `rewardRatePerSecond` path and the revenue-backed distributor MUST NOT both pay the same position.

Before reducing position principal:

```text
earnedSinceCheckpoint =
    weightedPrincipal * accRewardPerWeightedShare
    / REWARD_PRECISION
    - rewardDebt

pendingReward += earnedSinceCheckpoint

principal -= seizedPrincipal
weightedPrincipal = principal * tierWeight

rewardDebt =
    weightedPrincipal * accRewardPerWeightedShare
    / REWARD_PRECISION
```

The old `rewardDebt` MUST NOT be reduced pro rata. Rewards are checkpointed against the complete old principal first, then debt is rebuilt from the remaining principal.

`REWARD_PRECISION` SHOULD be at least `1e27`. Earned rewards before liquidation remain claimable by the user. Liquidation MUST NOT apply the voluntary early-withdraw reward penalty.

## 11. Reentrancy and execution ordering

Both entry points MUST have independent guards:

```solidity
LendingPoolV2.liquidate()                 nonReentrant
StakingVaultV2.seizeStakedCollateral()    nonReentrant onlyLendingPool
```

Only explicitly supported tokens are permitted. V2 initially supports Arc USDC and EURC and MUST reject arbitrary fee-on-transfer or callback-capable assets.

### 11.1 LendingPool execution order

1. Validate caller-independent inputs, deadline, supported assets, distinct or allowed asset pair, sorted IDs, and ID count.
2. Accrue all debt markets for the user.
3. Obtain oracle values through staleness and circuit-breaker validation, then freeze one in-memory snapshot.
4. Read selected seizable principal from StakingVault.
5. Calculate HF, close factor, final debt coverage, collateral seizure, bonus, and slippage result.
6. Update debt, loan status, interest accounting, and `pendingRevenue` using checks-effects-interactions.
7. Measure debt token `balanceBefore`, call `safeTransferFrom`, measure `balanceAfter`, and require exact receipt of `actualDebtToCover`.
8. Call StakingVault to checkpoint and seize the exact collateral amount.
9. Recalculate post-liquidation risk from resulting state.
10. Emit the aggregate liquidation event.

Any failure reverts the complete transaction, including the earlier effects.

### 11.2 StakingVault execution order

1. Authenticate LendingPool.
2. Revalidate sorted IDs, ownership, asset, activity, and selected principal.
3. Checkpoint reward for every affected position.
4. Reduce position principal and aggregate weighted stake.
5. Transfer the exact collateral amount to the liquidator.
6. Emit one position-level event per affected position.

## 12. Concurrent liquidators

EVM transactions execute sequentially. Every liquidation MUST calculate against execution-time state rather than a prior UI or keeper preview.

After a first liquidation succeeds, a second transaction MUST:

- accrue again;
- validate fresh prices;
- recalculate current debt, selected collateral, and HF;
- revert if the account is safe;
- otherwise cap against remaining debt and principal;
- enforce its own `minCollateralOut` and deadline.

This prevents double seizure and stale-quote execution without requiring a per-user liquidation lock across transactions.

## 13. Interest accounting and revenue settlement

Both `repay` and `liquidate` MUST pay accrued interest before principal:

```text
interestPaid = min(payment, accruedInterest)
principalPaid = payment - interestPaid
```

They MUST record, per asset:

```solidity
totalInterestCollected[asset] += interestPaid;
pendingRevenue[asset] += interestPaid;
```

Neither function calls RevenueRouter. Revenue settlement is permissionless and separate so repayment and liquidation liveness cannot depend on Treasury, Insurance, Credit Bonus, or RewardDistributor availability.

Borrowable liquidity MUST exclude all reserved balances:

```text
availableLiquidity =
    tokenBalance
    - pendingRevenue
    - otherReservedFunds
```

`settleRevenue(asset)` MUST update `pendingRevenue` before transferring tokens to RevenueRouter. RevenueRouter then splits the exact received amount:

```text
treasury = amount * 15% / 100%
insurance = amount * 10% / 100%
credit = amount * 10% / 100%
stakers = amount - treasury - insurance - credit
```

Assigning the remainder to stakers guarantees conservation despite integer rounding.

Revenue is same-asset. USDC revenue funds USDC rewards and EURC revenue funds EURC rewards. V2 MUST NOT perform an implicit swap.

The early-withdraw forfeiture reserve and the borrow-interest Insurance allocation are separate accounting sources and MUST be exposed separately to Analytics.

## 14. Bad debt realization and recovery

### 14.1 Eligible collateral scope

Bad debt MUST NOT be realized inside `liquidate`. One liquidation call exhausts only the supplied positions for one collateral asset and cannot prove that the user's complete portfolio is exhausted.

For each debt asset, LendingPool MUST maintain or obtain an enumerable, bounded set of eligible collateral assets. This MUST be the same set used by Health Factor, Available to Borrow, liquidation, and bad-debt finalization. Borrow-pair validation MUST use configuration rather than a hard-coded same-asset rule:

```solidity
if (!isBorrowPairEnabled[collateralAsset][debtAsset]) {
    revert BorrowPairNotSupported();
}
```

### 14.2 Permissionless finalization

`finalizeBadDebt(user, debtAsset)` MUST be permissionless and MUST execute only after debt accrual is checkpointed. Before any write-off, it MUST iterate over every eligible collateral asset and query actual seizable principal from StakingVault:

```solidity
for each collateralAsset in eligibleCollateralAssets[debtAsset]:
    if (stakingVault.getTotalSeizablePrincipal(user, collateralAsset) != 0) {
        revert CollateralRemaining();
    }
```

The eligible set MUST have a governance-enforced maximum length so this proof cannot become uncallable from unbounded gas growth.

If all seizable principal values are zero, finalization does not need an oracle price. If non-zero collateral remains, it MUST NOT be treated as worthless because its oracle is stale, paused, or invalid. That collateral must first be liquidated using a healthy oracle or an audited fallback/deprecation procedure.

This creates a deliberate known limitation: non-zero collateral with a permanently unusable oracle can delay liquidation and finalization. The protocol chooses this conservative failure mode over incorrectly writing valuable collateral down to zero.

### 14.3 Crystallization accounting

Once the complete eligible portfolio is proven exhausted, LendingPool MUST crystallize the full remaining debt without calling Insurance Fund, RevenueRouter, Treasury, or any other destination:

```solidity
principalLoss = userPrincipalDebt[user][debtAsset];
interestLoss = checkpointedAccruedInterest[user][debtAsset];
residualDebt = principalLoss + interestLoss;

userPrincipalDebt[user][debtAsset] = 0;
checkpointedAccruedInterest[user][debtAsset] = 0;
totalPerformingDebt[debtAsset] -= residualDebt;
totalBadDebtRealized[debtAsset] += residualDebt;
protocolDeficit[debtAsset] += residualDebt;
```

The user debt MUST be zeroed in the same transaction so the same loss cannot be finalized twice. Uncollected interest is a loss, not collected revenue, and MUST NOT increase `totalInterestCollected` or `pendingRevenue`.

Bad debt MUST NOT remain in utilization as performing debt. Analytics MUST expose Performing Debt, cumulative Bad Debt Realized, cumulative Bad Debt Covered, and current Protocol Deficit separately.

### 14.4 Borrow suspension by debt asset

Every borrow pair producing an asset with a non-zero deficit MUST reject new borrowing:

```solidity
canBorrow =
    isBorrowPairEnabled[collateralAsset][debtAsset]
    && protocolDeficit[debtAsset] == 0
    && !governanceBorrowPaused[debtAsset]
    && oracleIsHealthy(collateralAsset, debtAsset);
```

A USDC deficit therefore suspends every pair producing USDC debt without automatically suspending unrelated EURC debt. Repay, liquidation, bad-debt finalization, insurance resolution, and direct deficit coverage MUST remain callable while deficit borrowing is suspended.

### 14.5 Insurance resolution is a separate transaction

`liquidate` and `finalizeBadDebt` MUST NOT call Insurance Fund. Finalization first records 100% of residual debt in `protocolDeficit`.

`resolveDeficitFromInsurance(asset)` MAY be called by anyone. It requests no more than the smaller of current deficit and available Insurance balance. LendingPool MUST measure the token balance before and after the transfer and reduce deficit only by the exact amount received:

```solidity
requested = min(protocolDeficit[asset], insuranceFund.availableInsurance(asset));
balanceBefore = token.balanceOf(address(this));
insuranceFund.coverDeficit(asset, requested);
received = token.balanceOf(address(this)) - balanceBefore;

if (received == 0 || received > requested) revert InvalidInsuranceTransfer();

protocolDeficit[asset] -= received;
totalInsuranceUsedForBadDebt[asset] += received;
```

The function MUST be `nonReentrant`, use checks-effects-interactions or an equally safe pull pattern, and MUST NOT trust a return value in place of the observed token receipt.

`coverDeficit(asset, amount)` MAY allow governance or an external sponsor to recapitalize LendingPool directly. It MUST apply the same exact-receipt rule and MUST NOT reduce deficit below zero.

### 14.6 Automatic market recovery

Deficit-based borrow suspension MUST be derived directly from `protocolDeficit[debtAsset]`. It clears automatically only after tokens have actually reached LendingPool and the value becomes zero. Merely funding Insurance Fund does not clear a deficit; `resolveDeficitFromInsurance` must first move the funds.

Clearing a deficit MUST NOT clear independent governance, oracle, emergency, or borrow-pair configuration restrictions. No separate governance confirmation is required to clear only the deficit reason.

### 14.7 Insurance provenance

Insurance assets are fungible. Source attribution MUST therefore use cumulative counters rather than pretending that physically separate source balances exist:

```solidity
totalInsuranceFromForfeiture[asset]
totalInsuranceFromRevenue[asset]
totalInsuranceUsedForBadDebt[asset]
```

`availableInsurance(asset)` MUST be based on actual reserved assets. Events MUST preserve contribution and spending history. The UI MUST NOT present a remaining balance by source unless the contract also defines and enforces a deterministic source-spending order.

### 14.8 Bad-debt invariants

- Bad debt can be finalized only after every eligible collateral asset reports zero seizable principal.
- A stale oracle MUST NOT cause non-zero collateral to be treated as zero.
- `totalPerformingDebt` MUST exclude crystallized bad debt.
- `protocolDeficit` MUST never underflow.
- Insurance MUST NOT cover more than its available balance or the current deficit.
- Deficit reduction MUST equal debt tokens actually received by LendingPool.
- New borrowing of the deficit asset MUST remain disabled while `protocolDeficit` is non-zero.
- Deficit-based suspension MUST clear automatically at zero without clearing any other pause reason.

## 15. Authorization and upgrade path

For Arc Testnet V2, StakingVault MAY use a LendingPool address that is set exactly once.

For mainnet, the preferred design is:

- StakingVault authorizes a stable LendingPool proxy address;
- implementation upgrades are controlled by timelock plus multisig;
- changing the pool address, if supported, goes through a timelocked AddressProvider rather than an immediate owner setter.

Repay and liquidation MUST remain callable while normal borrowing or staking is paused.

## 16. Events

StakingVault MUST emit:

```solidity
event PositionCollateralSeized(
    uint256 indexed positionId,
    address indexed user,
    address indexed asset,
    uint256 amountSeized,
    uint256 remainingPrincipal
);
```

LendingPool MUST emit an aggregate event containing enough data for an indexer without reconstructing liquidation math:

```solidity
event Liquidated(
    address indexed user,
    address indexed liquidator,
    address indexed debtAsset,
    address collateralAsset,
    uint256 debtCovered,
    uint256 principalPaid,
    uint256 interestPaid,
    uint256 baseCollateral,
    uint256 liquidationBonus,
    uint256 collateralSeized,
    uint256 healthFactorBefore,
    uint256 healthFactorAfter,
    uint256 remainingUncoveredDebt
);
```

Bad-debt lifecycle events MUST separate principal loss from uncollected interest and expose the resulting current deficit:

```solidity
event BadDebtFinalized(
    address indexed user,
    address indexed debtAsset,
    uint256 principalLoss,
    uint256 interestLoss,
    uint256 resultingDeficit
);

event ProtocolDeficitCovered(
    address indexed asset,
    address indexed contributor,
    uint256 amountCovered,
    uint256 remainingDeficit
);

event DebtMarketRecovered(address indexed debtAsset);
```

RevenueRouter MUST emit settlement separately:

```solidity
event RevenueSettled(
    address indexed asset,
    uint256 totalAmount,
    uint256 stakerAmount,
    uint256 treasuryAmount,
    uint256 insuranceAmount,
    uint256 creditAmount
);
```

Every risk parameter update MUST emit its old and new values.

## 17. Required tests

### 17.1 Unit tests

- safe account cannot be liquidated;
- exact threshold behavior at `HF == 1e18`;
- standard and deep close-factor branches;
- full-position and partial-position seizure;
- multiple partial seizures of one position;
- multiple positions of the same asset;
- locked positions are seizable;
- accrued reward survives principal reduction;
- duplicate, unsorted, excessive, wrong-owner, wrong-asset, and withdrawn IDs revert;
- supplied IDs with insufficient principal cannot cause partial success;
- `minCollateralOut` and expired deadline revert;
- second liquidator revalidates after the first succeeds;
- stale, paused, invalid, or excessive-deviation oracle values revert before effects;
- token receipt mismatch reverts;
- repay and liquidation record interest consistently;
- pending revenue cannot be borrowed;
- settlement conserves the complete received amount;
- USDC and EURC accounting never mix;
- voluntary pause does not block repay or liquidation;
- reentrancy attempts through every external interaction fail.
- bad debt cannot be finalized while any eligible collateral asset has seizable principal;
- exhausting only the selected collateral asset cannot realize bad debt while another eligible asset remains;
- finalization cannot run twice for the same residual debt;
- uncollected interest written off as bad debt never enters pending revenue;
- stale oracle data never converts non-zero collateral into zero collateral;
- insurance resolution reduces deficit only by exact tokens received;
- funding Insurance alone does not clear deficit until funds reach LendingPool;
- deficit recovery re-enables only the deficit pause reason;

### 17.2 Fuzz and invariant tests

- debt decrease equals actual debt tokens received;
- aggregate principal decrease equals collateral transferred;
- total active position principal equals Vault aggregate stake;
- reward checkpoint never decreases already-earned rewards;
- no position principal or reward accounting underflow;
- selected collateral is never exceeded;
- standard recoverable liquidation improves HF;
- deep-insolvency liquidation reduces debt and does not create additional debt;
- total interest collected equals pending plus settled revenue;
- settled revenue equals all destination allocations;
- reserved revenue is never borrowable;
- claims never exceed revenue assigned to stakers;
- arbitrary ordering of stake, borrow, accrue, repay, distribute, claim, partial seize, and full seize preserves accounting conservation.
- arbitrary multi-asset liquidation order cannot realize bad debt before all eligible collateral is exhausted;
- performing debt plus crystallized losses remains conserved across finalization and coverage;
- a non-zero protocol deficit always blocks new debt creation in that asset;

## 18. Migration from V1

1. Keep V1 StakingVault and RewardDistributor available for existing claim, repay, and withdrawal flows.
2. Ensure manually funded V1 reward programs retain enough reserves for their promised windows.
3. Stop routing new stakes and borrows to V1 after V2 activation.
4. Deploy and connect `StakingVaultV2`, `LendingPoolV2`, oracle adapter, reward-index distributor, and RevenueRouter.
5. Route only new positions to V2 in the frontend.
6. Do not rewrite, copy, or forcibly migrate locked V1 positions without a separately audited migrator.
7. Keep Analytics values labeled by deployment until V1 is fully retired.

## 19. Implementation order

1. Freeze this specification and its economic parameters.
2. Write interfaces and calculation libraries.
3. Implement reward checkpoint and exact collateral seizure in StakingVaultV2.
4. Implement liquidation, interest accounting, reserved liquidity, bad-debt finalization, and settlement entry points in LendingPoolV2.
5. Implement Insurance resolution, RevenueRouter, and destination reserves.
6. Add unit, fuzz, invariant, and adversarial token/oracle tests.
7. Perform an independent security review.
8. Deploy V2 in parallel on Arc Testnet and validate indexer events before frontend migration.

## 20. Mainnet blockers

This specification does not make Shiny mainnet-ready by itself. Mainnet remains blocked until at least:

- production-grade oracle coverage and fallback behavior exist;
- V2 liquidation invariants pass fuzz/invariant testing;
- governance and upgrade controls are timelocked and multisig-controlled;
- reward index and RevenueRouter accounting are independently reviewed;
- monitoring, keeper coverage, incident response, oracle fallback/deprecation, and bad-debt recovery are operational.
