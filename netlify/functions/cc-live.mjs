import { getStore } from "@netlify/blobs";
import { live, STORE_NAME } from "../lib/cc.mjs";

export default (req) => live(req, getStore({ name: STORE_NAME, consistency: "strong" }));

export const config = { path: "/api/cc/live" };
