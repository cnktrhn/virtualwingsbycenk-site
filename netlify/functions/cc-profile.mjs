import { getStore } from "@netlify/blobs";
import { profile, STORE_NAME, FLIGHTS_STORE } from "../lib/cc.mjs";

export default (req) => profile(req, getStore({ name: STORE_NAME, consistency: "strong" }), undefined, getStore({ name: FLIGHTS_STORE, consistency: "strong" }));

export const config = { path: "/api/cc/profile" };
