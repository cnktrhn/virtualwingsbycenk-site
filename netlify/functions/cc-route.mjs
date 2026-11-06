import { getStore } from "@netlify/blobs";
import { route, STORE_NAME } from "../lib/cc.mjs";

export default (req) => route(req, getStore({ name: STORE_NAME, consistency: "strong" }));

export const config = { path: "/api/cc/route" };
