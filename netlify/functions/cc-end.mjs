import { getStore } from "@netlify/blobs";
import { end, STORE_NAME, FLIGHTS_STORE } from "../lib/cc.mjs";

export default (req) => end(req, getStore({ name: STORE_NAME, consistency: "strong" }), getStore({ name: FLIGHTS_STORE, consistency: "strong" }));

export const config = { path: "/api/cc/end" };
