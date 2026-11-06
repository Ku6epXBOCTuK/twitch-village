import type { CoreToWidget, Transport, WidgetToCore } from "@tv/protocol";
import { createPizdudesWidget } from "./widget";

const scope = self as DedicatedWorkerGlobalScope;

const listeners = new Set<(message: CoreToWidget) => void>();
const onMessage = (event: MessageEvent<CoreToWidget>): void => {
	for (const listener of listeners) listener(event.data);
};

scope.addEventListener("message", onMessage);

const transport: Transport<WidgetToCore, CoreToWidget> = {
	send: (message) => scope.postMessage(message),
	subscribe: (handler) => {
		listeners.add(handler);
		return () => {
			listeners.delete(handler);
		};
	},
	dispose: () => {
		scope.removeEventListener("message", onMessage);
		listeners.clear();
		scope.close();
	},
};

createPizdudesWidget(transport);
