export const PROTOCOL_VERSION = 1;
export const PROTOCOL_MAJOR = 1;

export function isCompatible(remote: number): boolean {
	return remote === PROTOCOL_MAJOR;
}
