import { getStore } from "@netlify/blobs";
import { recent, FLIGHTS_STORE } from "../lib/cc.mjs";

export default (req) => recent(req, getStore({ name: FLIGHTS_STORE, consistency: "strong" }));

export const config = { path: "/api/cc/recent" };
