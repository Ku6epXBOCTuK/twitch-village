export const PROTOCOL_VERSION = 2;
export const PROTOCOL_MAJOR = 2;

export function isCompatible(remote: number): boolean {
	return remote === PROTOCOL_MAJOR;
}
