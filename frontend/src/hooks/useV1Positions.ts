// V1 is retained for existing user positions. Keep its reader isolated so
// position IDs never collide with the independent V2 vault ID space.
export { usePositions as useV1Positions } from './usePositions';
export type { StakePosition as V1StakePosition } from './usePositions';
