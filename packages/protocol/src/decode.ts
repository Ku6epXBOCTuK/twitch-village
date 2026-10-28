import { Schema } from "effect";
import { WidgetToCoreSchema } from "./events";

const decodeEnvelope = Schema.decodeUnknownResult(WidgetToCoreSchema);

export const decodeWidgetToCore = (input: unknown) =>
	decodeEnvelope(input, { onExcessProperty: "error" });
