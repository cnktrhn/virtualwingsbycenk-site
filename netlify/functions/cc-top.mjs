import { getStore } from "@netlify/blobs";
import { top, STORE_NAME } from "../lib/cc.mjs";

export default (req) => top(req, getStore({ name: STORE_NAME, consistency: "strong" }));

export const config = { path: "/api/cc/top" };
