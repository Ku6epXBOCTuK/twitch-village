import { defineConfig } from "vite";

export default defineConfig({
	publicDir: "../../packages/widget-pizdudes/dist-assets",
	server: {
		port: 5173,
		host: true,
	},
	optimizeDeps: {
		exclude: [
			"@tv/core",
			"@tv/event-mock",
			"@tv/protocol",
			"@tv/widget-pizdudes",
		],
	},
	worker: {
		format: "es",
	},
	build: {
		target: "es2022",
	},
});
