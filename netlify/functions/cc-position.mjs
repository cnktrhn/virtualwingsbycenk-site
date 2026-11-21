import { getStore } from "@netlify/blobs";
import { position, STORE_NAME, FLIGHTS_STORE } from "../lib/cc.mjs";
import { LIC_STORE } from "../lib/lic.mjs";

export default (req) => position(req, getStore({ name: STORE_NAME, consistency: "strong" }), undefined, getStore({ name: FLIGHTS_STORE, consistency: "strong" }), getStore({ name: LIC_STORE }));

export const config = { path: "/api/cc/position" };
