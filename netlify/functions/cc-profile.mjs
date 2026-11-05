import { getStore } from "@netlify/blobs";
import { profile, STORE_NAME } from "../lib/cc.mjs";

export default (req) => profile(req, getStore({ name: STORE_NAME, consistency: "strong" }));

export const config = { path: "/api/cc/profile" };
