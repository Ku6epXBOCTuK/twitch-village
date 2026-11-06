import { defineConfig } from "vite";

export default defineConfig({
	publicDir: "public",
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
			"@tv/widget-shooting-words",
		],
	},
	worker: {
		format: "es",
	},
	build: {
		target: "es2022",
	},
});
