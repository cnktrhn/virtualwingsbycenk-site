import { getStore } from "@netlify/blobs";
import { live, STORE_NAME, FLIGHTS_STORE } from "../lib/cc.mjs";

export default (req) => live(req, getStore({ name: STORE_NAME, consistency: "strong" }), undefined, getStore({ name: FLIGHTS_STORE, consistency: "strong" }));

export const config = { path: "/api/cc/live" };
