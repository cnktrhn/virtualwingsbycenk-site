import { getStore } from "@netlify/blobs";
import { position, STORE_NAME } from "../lib/cc.mjs";

export default (req) => position(req, getStore({ name: STORE_NAME, consistency: "strong" }));

export const config = { path: "/api/cc/position" };
