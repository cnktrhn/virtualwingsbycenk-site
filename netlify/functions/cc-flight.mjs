import { getStore } from "@netlify/blobs";
import { flight, STORE_NAME, FLIGHTS_STORE } from "../lib/cc.mjs";
import { LIC_STORE } from "../lib/lic.mjs";

export default (req) => flight(req,
  getStore({ name: STORE_NAME, consistency: "strong" }),
  getStore({ name: FLIGHTS_STORE, consistency: "strong" }),
  undefined, getStore({ name: LIC_STORE }));

export const config = { path: "/api/cc/flight" };
