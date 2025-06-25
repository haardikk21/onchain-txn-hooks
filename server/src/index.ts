import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { contractService } from "./services/contract-service";
import type { ApiResponse } from "shared/dist";
import { isAddress } from "viem";

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
})

// Contract ABI endpoints
.get("/contracts/:address/abi", async (c) => {
	const address = c.req.param('address');
	
	if (!isAddress(address)) {
		const errorResponse: ApiResponse = {
			success: false,
			error: 'Invalid contract address format'
		};
		return c.json(errorResponse, { status: 400 });
	}

	try {
		const abi = await contractService.getContractABI(address);
		const response: ApiResponse = {
			success: true,
			data: { abi, address }
		};
		return c.json(response, { status: 200 });
	} catch (error) {
		const errorResponse: ApiResponse = {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to fetch contract ABI'
		};
		return c.json(errorResponse, { status: 500 });
	}
})

.get("/contracts/:address/events", async (c) => {
	const address = c.req.param('address');
	
	if (!isAddress(address)) {
		const errorResponse: ApiResponse = {
			success: false,
			error: 'Invalid contract address format'
		};
		return c.json(errorResponse, { status: 400 });
	}

	try {
		const abi = await contractService.getContractABI(address);
		const events = contractService.extractEvents(abi);
		
		// Add helper methods for each event
		const eventsWithHelpers = events.map(event => ({
			...event,
			signature: contractService.getEventSignature(event),
			hash: contractService.getEventHash(event),
			indexedParams: contractService.getIndexedParameters(event),
			nonIndexedParams: contractService.getNonIndexedParameters(event)
		}));
		
		const response: ApiResponse = {
			success: true,
			data: { events: eventsWithHelpers, address }
		};
		return c.json(response, { status: 200 });
	} catch (error) {
		const errorResponse: ApiResponse = {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to fetch contract events'
		};
		return c.json(errorResponse, { status: 500 });
	}
});

export default app;