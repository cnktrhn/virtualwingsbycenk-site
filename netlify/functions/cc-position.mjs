import { getStore } from "@netlify/blobs";
import { position, STORE_NAME, FLIGHTS_STORE } from "../lib/cc.mjs";

export default (req) => position(req, getStore({ name: STORE_NAME, consistency: "strong" }), undefined, getStore({ name: FLIGHTS_STORE, consistency: "strong" }));

export const config = { path: "/api/cc/position" };
