import { getStore } from "@netlify/blobs";
import { profile, STORE_NAME, FLIGHTS_STORE } from "../lib/cc.mjs";
import { LIC_STORE } from "../lib/lic.mjs";

export default (req) => profile(req, getStore({ name: STORE_NAME, consistency: "strong" }), undefined, getStore({ name: FLIGHTS_STORE, consistency: "strong" }), getStore({ name: LIC_STORE }));

export const config = { path: "/api/cc/profile" };
