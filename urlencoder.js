"use strict";
let url = require("url");

function urlEncoder(params) {
  let p = new url.URLSearchParams();
  for (let [name, values] of Object.entries(params)) {
    if (Array.isArray(values)) {
      for (let value of values) {
        p.append(name, value);
      }
    } else {
      p.append(name, values);
    }
  }
  return p.toString();
}

module.exports = urlEncoder;
