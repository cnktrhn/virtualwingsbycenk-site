import { getStore } from "@netlify/blobs";
import { atcOnline, ATC_STORE } from "../lib/atc.mjs";

// Adres: /.netlify/functions/atc-online?net=vatsim | ?net=ivao
export default (req) => atcOnline(req, getStore({ name: ATC_STORE, consistency: "strong" }));
