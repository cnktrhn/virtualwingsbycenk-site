import { getStore } from "@netlify/blobs";
import { end, STORE_NAME } from "../lib/cc.mjs";

export default (req) => end(req, getStore({ name: STORE_NAME, consistency: "strong" }));

export const config = { path: "/api/cc/end" };
