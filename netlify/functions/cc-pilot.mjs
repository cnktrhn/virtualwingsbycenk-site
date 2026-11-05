import { getStore } from "@netlify/blobs";
import { pilot, STORE_NAME } from "../lib/cc.mjs";

export default (req) => pilot(req, getStore({ name: STORE_NAME, consistency: "strong" }));

export const config = { path: "/api/cc/pilot" };
