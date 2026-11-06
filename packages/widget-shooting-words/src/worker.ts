import type { CoreToWidget, Transport, WidgetToCore } from "@tv/protocol";
import { createShootingWordsWidget } from "./widget";

const scope = self as DedicatedWorkerGlobalScope;
const listeners = new Set<(message: CoreToWidget) => void>();

const onMessage = (event: MessageEvent<CoreToWidget>): void => {
	for (const listener of [...listeners]) listener(event.data);
};

scope.addEventListener("message", onMessage);

const transport: Transport<WidgetToCore, CoreToWidget> = {
	send: (message) => {
		scope.postMessage(message);
	},
	subscribe: (listener) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
	dispose: () => {
		scope.removeEventListener("message", onMessage);
		listeners.clear();
		scope.close();
	},
};

createShootingWordsWidget(transport);
