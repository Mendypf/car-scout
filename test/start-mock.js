// Starts the app wired to the local mock Vapi (npm run mock in another shell),
// so calls can be exercised end to end without dialing anyone.
process.env.VAPI_BASE_URL = process.env.VAPI_BASE_URL || "http://localhost:4399";
process.env.VAPI_API_KEY = process.env.VAPI_API_KEY || "mock-key";
await import("../server.js");
