import {
	InvalidCommand,
	UnknownNode,
	type AssetNotFound,
	type EffectCompileFailed,
	type EffectNotFound,
	type InvalidEffectParam,
	type RenderFailed,
} from "@tv/protocol";

export type RenderError =
	| AssetNotFound
	| EffectCompileFailed
	| EffectNotFound
	| InvalidCommand
	| InvalidEffectParam
	| RenderFailed
	| UnknownNode;

export type ContractError = InvalidCommand | UnknownNode;

// NOTE: the render target throws only these two, everything else is a
// foreign crash and becomes RenderFailed at the boundary.
export const isContractError = (error: unknown): error is ContractError =>
	error instanceof InvalidCommand || error instanceof UnknownNode;
