import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import type { ApiResponse } from "shared/dist";

export const app = new Hono()

.use(cors({
	origin: ['http://localhost:5173', 'http://localhost:3000'], // Add your frontend URLs
	credentials: true, // Allow cookies
}))

.route('/auth', auth)

.get("/", (c) => {
	return c.text("Onchain Transaction Hooks API");
})

.get("/hello", async (c) => {
	const data: ApiResponse = {
		message: "Hello from Transaction Hooks!",
		success: true,
	};

	return c.json(data, { status: 200 });
});

export default app;